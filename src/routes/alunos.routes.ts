import { FastifyInstance } from "fastify";
import { z } from "zod";
import { lerPaginacao, paginar } from "../utils/paginacao.js";
import { dataOpcional, fotoOpcional, textoOpcional } from "../utils/zod.js";
import { incluirResponsavel, ocultarDesconto } from "../utils/privacidade.js";
import { cobrancasDoCadastro, recalcularNaoPagas } from "../services/cobranca.js";
import { comDisciplinaIds, includeCurriculo } from "./turmas.routes.js";

export const schema = z.object({
  nome: z.string().min(1),
  dataNascimento: dataOpcional,
  foto: fotoOpcional,
  turmaId: z.number().int(),
  responsavelId: z.number().int(),
  status: z.enum(["ATIVO", "INATIVO"]).optional(),

  // Cobrança: dia de vencimento próprio (null = padrão da escola) e desconto/bolsa.
  diaVencimento: z.number().int().min(1, { message: "Dia de 1 a 31." }).max(31, { message: "Dia de 1 a 31." }).nullable().optional(),
  tipoDesconto: z.enum(["BOLSA_INTEGRAL", "PERCENTUAL", "VALOR"]).nullable().optional(),
  valorDesconto: z.number().min(0, { message: "O desconto não pode ser negativo." }).nullable().optional(),
  motivoDesconto: textoOpcional,
  descontoAte: dataOpcional,
});

export const atualizarSchema = schema.partial().extend({
  /** Aplica mudança de dia de vencimento ou de desconto às cobranças não pagas já existentes. */
  aplicarPendentes: z.boolean().optional(),
});

const CAMPOS_DESCONTO = ["tipoDesconto", "valorDesconto", "motivoDesconto", "descontoAte"] as const;

/**
 * Valida o desconto já combinado com o que está gravado (no PATCH) e normaliza:
 * sem tipo → limpa todos os campos de desconto; bolsa integral → valorDesconto null.
 * Retorna a mensagem de erro, ou null se estiver ok.
 */
function normalizarDesconto(dados: Record<string, unknown>, atual?: Record<string, unknown>) {
  const tipo = (dados.tipoDesconto !== undefined ? dados.tipoDesconto : atual?.tipoDesconto) ?? null;
  const valorBruto = dados.valorDesconto !== undefined ? dados.valorDesconto : atual?.valorDesconto;
  const valor = valorBruto === null || valorBruto === undefined ? null : Number(valorBruto);

  if (tipo === null) {
    if (dados.valorDesconto !== undefined && dados.valorDesconto !== null) return "Informe o tipo de desconto.";
    if (dados.tipoDesconto === null) for (const c of CAMPOS_DESCONTO) dados[c] = null;
    return null;
  }
  if (tipo === "BOLSA_INTEGRAL") {
    if (dados.tipoDesconto !== undefined) dados.valorDesconto = null;
    return null;
  }
  if (valor === null) return "Informe o valor do desconto.";
  if (tipo === "PERCENTUAL" && (valor < 0 || valor > 100)) return "O percentual de desconto deve ficar entre 0 e 100.";
  return null;
}

export const observacaoSchema = z.object({
  anoLetivo: z.number().int(),
  /** "anual" ou o semestre ("1" / "2"), como na tela do boletim. */
  periodo: z.enum(["anual", "1", "2"]),
  texto: z.string().trim().max(1800, { message: "Limite de 1.800 caracteres." }),
});

export default async function alunosRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = request.query as { busca?: string; status?: string; pagina?: string; tamanhoPagina?: string };

    const where = {
      ...(query.busca ? { nome: { contains: query.busca, mode: "insensitive" as const } } : {}),
      ...(query.status === "TODOS" ? {} : { status: (query.status as "ATIVO" | "INATIVO") ?? "ATIVO" }),
    };

    const argsComuns = { where, include: { turma: true, responsavel: incluirResponsavel(request.user.perfil) }, orderBy: { nome: "asc" as const } };

    const ocultar = <T extends object>(lista: T[]) => lista.map((a) => ocultarDesconto(request.user.perfil, a));

    const paginacao = lerPaginacao(query);
    if (!paginacao) {
      return ocultar(await app.prisma.aluno.findMany(argsComuns));
    }

    const [dados, total] = await Promise.all([
      app.prisma.aluno.findMany({ ...argsComuns, skip: paginacao.skip, take: paginacao.take }),
      app.prisma.aluno.count({ where }),
    ]);
    return paginar(ocultar(dados), total, paginacao);
  });

  app.get("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const aluno = await app.prisma.aluno.findUnique({
      where: { id },
      include: { turma: true, responsavel: incluirResponsavel(request.user.perfil) },
    });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });
    return ocultarDesconto(request.user.perfil, aluno);
  });

  app.get("/:id/boletim", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const encontrado = await app.prisma.aluno.findUnique({
      where: { id },
      include: { turma: { include: includeCurriculo } },
    });
    if (!encontrado) return reply.code(404).send({ message: "Aluno não encontrado" });
    const aluno = ocultarDesconto(request.user.perfil, { ...encontrado, turma: comDisciplinaIds(encontrado.turma) });

    const [notas, observacoes] = await Promise.all([
      app.prisma.nota.findMany({
        where: { alunoId: id },
        include: { disciplina: true },
        orderBy: [{ disciplina: { nome: "asc" } }, { bimestre: "asc" }],
      }),
      app.prisma.observacaoBoletim.findMany({
        where: { alunoId: id },
        select: { anoLetivo: true, periodo: true, texto: true },
        orderBy: [{ anoLetivo: "desc" }, { periodo: "asc" }],
      }),
    ]);

    return { aluno, notas, observacoes };
  });

  /** Salva (cria ou substitui) a observação do boletim para um ano letivo + período. */
  app.patch("/:id/boletim", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = observacaoSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const aluno = await app.prisma.aluno.findUnique({ where: { id }, select: { id: true } });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });

    const { anoLetivo, periodo, texto } = body.data;
    return app.prisma.observacaoBoletim.upsert({
      where: { alunoId_anoLetivo_periodo: { alunoId: id, anoLetivo, periodo } },
      create: { alunoId: id, anoLetivo, periodo, texto },
      update: { texto },
      select: { anoLetivo: true, periodo: true, texto: true },
    });
  });

  /** Cadastra o aluno e, na mesma transação, gera a matrícula ou a mensalidade do mês (ver services/cobranca). */
  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const dados: Record<string, unknown> = { ...body.data };
    const erro = normalizarDesconto(dados);
    if (erro) return reply.code(400).send({ message: erro });

    const { aluno, cobrancasCriadas } = await app.prisma.$transaction(async (tx) => {
      const criado = await tx.aluno.create({ data: dados as typeof body.data, include: { turma: true } });
      const cobrancas = criado.status === "ATIVO" ? await cobrancasDoCadastro(tx, criado) : [];
      return { aluno: criado, cobrancasCriadas: cobrancas };
    });

    const { turma: _turma, ...semTurma } = aluno;
    return reply.code(201).send({ ...semTurma, cobrancasCriadas });
  });

  /**
   * Mudou a turma → recalcula SEMPRE as cobranças não pagas (valor da nova turma + desconto atual).
   * Mudou dia de vencimento ou desconto → recalcula as não pagas só com aplicarPendentes: true.
   */
  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = atualizarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const { aplicarPendentes, ...dados } = body.data as typeof body.data & Record<string, unknown>;
    const atual = await app.prisma.aluno.findUnique({ where: { id } });
    if (!atual) return reply.code(404).send({ message: "Aluno não encontrado" });

    const erro = normalizarDesconto(dados, atual as unknown as Record<string, unknown>);
    if (erro) return reply.code(400).send({ message: erro });

    const turmaMudou = dados.turmaId !== undefined && dados.turmaId !== atual.turmaId;
    const diaMudou = dados.diaVencimento !== undefined && dados.diaVencimento !== atual.diaVencimento;
    const descontoMudou = CAMPOS_DESCONTO.some((c) => dados[c] !== undefined);

    return app.prisma.$transaction(async (tx) => {
      const aluno = await tx.aluno.update({ where: { id }, data: dados, include: { turma: true } });

      let cobrancasRecalculadas = 0;
      if (turmaMudou) {
        cobrancasRecalculadas = await recalcularNaoPagas(tx, aluno, {
          valorTurma: aluno.turma.valorMensalidade,
          recalcularVencimento: Boolean(aplicarPendentes && diaMudou),
        });
      } else if (aplicarPendentes && (diaMudou || descontoMudou)) {
        cobrancasRecalculadas = await recalcularNaoPagas(tx, aluno, { recalcularVencimento: diaMudou });
      }

      const { turma: _turma, ...semTurma } = aluno;
      return { ...semTurma, cobrancasRecalculadas };
    });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.aluno.update({ where: { id }, data: { status: "INATIVO" } });
    return reply.code(204).send();
  });
}
