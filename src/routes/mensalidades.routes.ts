import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { lerPaginacao, paginar } from "../utils/paginacao.js";
import { dataOpcionalSemNull } from "../utils/zod.js";
import { incluirResponsavel } from "../utils/privacidade.js";
import { agora, dataCalendario, dataNoMes, hojeSP, ymd } from "../utils/relogio.js";
import {
  calcularCobranca,
  gerarMensalidades,
  mensalidadeDoAluno,
  mesTemCobranca,
  montarValores,
  obterConfiguracao,
  STATUS_NAO_PAGOS,
} from "../services/cobranca.js";

const mesReferencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Use o formato "AAAA-MM".' });

export const criarSchema = z.object({
  alunoId: z.number().int(),
  tipo: z.enum(["MENSALIDADE", "MATRICULA"]).optional(),
  mesReferencia,
  /** Valor cheio. O desconto do aluno é aplicado, a menos que `desconto` venha explícito. */
  valor: z.number().positive(),
  /** Desconto explícito em R$ (substitui o desconto do aluno). */
  desconto: z.number().min(0).optional(),
  vencimento: z.coerce.date(),
});

export const pagamentoSchema = z.object({
  formaPagamento: z.enum(["PIX", "BOLETO", "CARTAO", "DINHEIRO", "FOLHA_PAGAMENTO"]),
  dataPagamento: dataOpcionalSemNull,
});

export const gerarSchema = z.object({ mesReferencia });

const alunoIdSchema = z.number().int().positive();
const pagamentoEmLoteSchema = pagamentoSchema.extend({
  alunoId: alunoIdSchema,
  ano: z.number().int(),
  meses: z.array(z.number().int().min(1).max(12)).min(1).max(12)
    .refine((meses) => new Set(meses).size === meses.length, "Selecione cada mês uma única vez."),
  totalCentavos: z.number().int().nonnegative(),
});

async function competenciasDoAluno(db: Prisma.TransactionClient, alunoId: number, ano: number, hoje: string) {
  const aluno = await db.aluno.findUnique({ where: { id: alunoId }, include: { turma: true } });
  if (!aluno) return null;
  const config = await obterConfiguracao(db);
  const cobrancas = await db.mensalidade.findMany({
    where: { alunoId, tipo: "MENSALIDADE", mesReferencia: { startsWith: `${ano}-` } },
  });
  const existentes = new Map(cobrancas.map((c) => [c.mesReferencia, c]));
  return Array.from({ length: 12 }, (_, indice) => {
    const mes = indice + 1;
    const referencia = dataNoMes(ano, mes, 1).slice(0, 7);
    const existente = existentes.get(referencia);
    const elegivel = aluno.status === "ATIVO" && ymd(aluno.matriculaEm) <= dataNoMes(ano, mes, 31) && mesTemCobranca(referencia, config);
    const nova = !existente && elegivel ? mensalidadeDoAluno(aluno, referencia, config, hoje) : null;
    return { mes, existente, nova };
  });
}

export const editarSchema = z
  .object({
    vencimento: z.coerce.date(),
    valorOriginal: z.number().min(0),
    desconto: z.number().min(0, { message: "O desconto não pode ser negativo." }),
  })
  .partial();

const STATUS_VALIDOS = ["PAGO", "PENDENTE", "ATRASADO", "ISENTO"] as const;
const TIPOS_VALIDOS = ["MENSALIDADE", "MATRICULA"] as const;

export default async function mensalidadesRoutes(app: FastifyInstance) {
  // Dados financeiros: só admin.
  app.addHook("preHandler", app.authorize(["admin"]));

  /** Filtros: status (inclui ISENTO), tipo, mesReferencia, alunoId. ISENTO nunca vira ATRASADO. */
  app.get("/", async (request) => {
    const query = request.query as {
      status?: string; tipo?: string; mesReferencia?: string; alunoId?: string; pagina?: string; tamanhoPagina?: string;
    };

    // Atrasada = vencimento antes de hoje (São Paulo). No próprio dia do vencimento ainda está em dia.
    await app.prisma.mensalidade.updateMany({
      where: { status: "PENDENTE", vencimento: { lt: dataCalendario(hojeSP()) } },
      data: { status: "ATRASADO" },
    });

    const status = STATUS_VALIDOS.find((s) => s === query.status);
    const tipo = TIPOS_VALIDOS.find((t) => t === query.tipo);
    const where: Prisma.MensalidadeWhereInput = {
      status,
      tipo,
      mesReferencia: query.mesReferencia,
      alunoId: query.alunoId ? Number(query.alunoId) : undefined,
    };
    const argsComuns = {
      where,
      include: { aluno: { include: { responsavel: incluirResponsavel(request.user.perfil), turma: true } } },
      orderBy: { vencimento: "asc" as const },
    };

    const paginacao = lerPaginacao(query);
    if (!paginacao) {
      return app.prisma.mensalidade.findMany(argsComuns);
    }

    const [dados, total] = await Promise.all([
      app.prisma.mensalidade.findMany({ ...argsComuns, skip: paginacao.skip, take: paginacao.take }),
      app.prisma.mensalidade.count({ where }),
    ]);
    return paginar(dados, total, paginacao);
  });

  /** Cobrança manual. `valor` é o valor cheio; aplica o desconto do aluno, salvo `desconto` explícito. */
  app.post("/", async (request, reply) => {
    const body = criarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const { alunoId, valor, desconto, vencimento: venc, ...resto } = body.data;
    const tipo = resto.tipo ?? "MENSALIDADE";
    const vencimento = ymd(venc);

    const aluno = await app.prisma.aluno.findUnique({ where: { id: alunoId } });
    if (!aluno) return reply.code(400).send({ message: "Aluno não encontrado." });

    if (tipo === "MATRICULA") {
      const ano = resto.mesReferencia.slice(0, 4);
      const ja = await app.prisma.mensalidade.findFirst({
        where: { alunoId, tipo: "MATRICULA", mesReferencia: { startsWith: `${ano}-` } },
      });
      if (ja) return reply.code(409).send({ message: `Já existe matrícula desse aluno em ${ano}.` });
    }

    let valores;
    if (desconto !== undefined) {
      if (desconto > valor) return reply.code(400).send({ message: "O desconto não pode ser maior que o valor." });
      valores = montarValores(valor, desconto, vencimento);
    } else {
      const config = await obterConfiguracao(app.prisma);
      const usaDesconto = tipo === "MENSALIDADE" || config.descontoNaMatricula;
      valores = calcularCobranca(valor, usaDesconto ? aluno : null, vencimento);
    }

    const mensalidade = await app.prisma.mensalidade.create({
      data: { alunoId, tipo, mesReferencia: resto.mesReferencia, vencimento: dataCalendario(vencimento), ...valores },
    });
    return reply.code(201).send(mensalidade);
  });

  /**
   * Gera as mensalidades do mês para os alunos ativos (idempotente). Funciona mesmo com a cobrança
   * automática desligada. Mês fora dos meses configurados → 400 com criadas: 0 e aviso.
   */
  app.post("/gerar", async (request, reply) => {
    const body = gerarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const resultado = await gerarMensalidades(app.prisma, body.data.mesReferencia, app.log);
    if (resultado.aviso) return reply.code(400).send({ message: resultado.aviso, ...resultado });
    return resultado;
  });

  app.get("/pagamentos/:alunoId", async (request, reply) => {
    const id = alunoIdSchema.safeParse(Number((request.params as { alunoId: string }).alunoId));
    if (!id.success) return reply.code(400).send({ message: "Selecione um aluno." });
    const hoje = hojeSP();
    const ano = Number(hoje.slice(0, 4));
    const competencias = await competenciasDoAluno(app.prisma, id.data, ano, hoje);
    if (!competencias) return reply.code(404).send({ message: "Aluno não encontrado." });
    return {
      ano,
      meses: competencias.map(({ mes, existente, nova }) => ({
        mes,
        status: existente?.status ?? nova?.status ?? "INDISPONIVEL",
        centavos: (existente ?? nova)?.valor.mul(100).toNumber() ?? 0,
      })),
    };
  });

  app.post("/pagamentos", async (request, reply) => {
    const body = pagamentoEmLoteSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const { alunoId, ano, meses, totalCentavos, formaPagamento, dataPagamento } = body.data;
    const hoje = hojeSP();
    if (ano !== Number(hoje.slice(0, 4))) return reply.code(400).send({ message: "Selecione competências do ano corrente." });
    const dadosPagamento = { status: "PAGO" as const, formaPagamento, dataPagamento: dataPagamento ?? agora() };
    const mensagemConflito = "As mensalidades foram atualizadas. Confira os meses e o valor antes de registrar.";

    try {
      const resultado = await app.prisma.$transaction(async (tx) => {
        const competencias = await competenciasDoAluno(tx, alunoId, ano, hoje);
        if (!competencias) return { erro: 404 as const, message: "Aluno não encontrado." };
        const selecionadas = competencias.filter(({ mes }) => meses.includes(mes));
        const pagaveis = selecionadas.flatMap(({ existente, nova }) => {
          if (existente && (existente.status === "PENDENTE" || existente.status === "ATRASADO")) return [{ existente, nova }];
          if (nova && nova.status !== "ISENTO") return [{ existente, nova }];
          return [];
        });
        const total = pagaveis.reduce((soma, { existente, nova }) => soma + (existente ?? nova)!.valor.mul(100).toNumber(), 0);
        if (pagaveis.length !== meses.length || total !== totalCentavos) return { erro: 409 as const, message: mensagemConflito };

        for (const { existente, nova } of pagaveis) {
          if (existente) {
            await tx.mensalidade.update({ where: { id: existente.id }, data: dadosPagamento });
          } else if (nova) {
            await tx.mensalidade.create({ data: { ...nova, ...dadosPagamento } });
          }
        }
        return { registradas: meses.length };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if ("erro" in resultado && resultado.erro) return reply.code(resultado.erro).send({ message: resultado.message });
      return resultado;
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(erro.code)) {
        return reply.code(409).send({ message: mensagemConflito });
      }
      throw erro;
    }
  });

  /** Edita uma cobrança não paga: valor = original − desconto; situação recalculada (ISENTO se zero). */
  app.patch("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = editarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const atual = await app.prisma.mensalidade.findUnique({ where: { id } });
    if (!atual) return reply.code(404).send({ message: "Cobrança não encontrada." });
    if (!STATUS_NAO_PAGOS.includes(atual.status)) {
      return reply.code(409).send({ message: "Cobrança já paga não pode ser alterada." });
    }

    const valorOriginal = body.data.valorOriginal ?? atual.valorOriginal;
    const desconto = body.data.desconto ?? atual.desconto;
    if (new Prisma.Decimal(desconto).gt(valorOriginal)) {
      return reply.code(400).send({ message: "O desconto não pode ser maior que o valor." });
    }
    const vencimento = body.data.vencimento ? ymd(body.data.vencimento) : ymd(atual.vencimento);

    return app.prisma.mensalidade.update({
      where: { id },
      data: { vencimento: dataCalendario(vencimento), ...montarValores(valorOriginal, desconto, vencimento) },
    });
  });

  app.patch("/:id/pagamento", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = pagamentoSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const atual = await app.prisma.mensalidade.findUnique({ where: { id }, select: { status: true } });
    if (!atual) return reply.code(404).send({ message: "Cobrança não encontrada." });
    const atualizado = await app.prisma.mensalidade.updateMany({
      where: { id, status: { in: ["PENDENTE", "ATRASADO"] } },
      data: {
        status: "PAGO",
        formaPagamento: body.data.formaPagamento,
        dataPagamento: body.data.dataPagamento ?? new Date(),
      },
    });
    if (!atualizado.count) return reply.code(409).send({ message: "Esta cobrança já foi paga ou está isenta." });
    return app.prisma.mensalidade.findUnique({ where: { id } });
  });

  app.delete("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.mensalidade.delete({ where: { id } });
    return reply.code(204).send();
  });
}
