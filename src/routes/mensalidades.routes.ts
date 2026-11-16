import { FastifyInstance } from "fastify";
import { z } from "zod";
import { lerPaginacao, paginar } from "../utils/paginacao.js";

export const criarSchema = z.object({
  alunoId: z.number().int(),
  mesReferencia: z.string().regex(/^\d{4}-\d{2}$/),
  valor: z.number().positive(),
  vencimento: z.coerce.date(),
});

export const pagamentoSchema = z.object({
  formaPagamento: z.enum(["PIX", "BOLETO", "CARTAO", "DINHEIRO", "FOLHA_PAGAMENTO"]),
  dataPagamento: z.coerce.date().optional(),
});

export default async function mensalidadesRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = request.query as { status?: string; mesReferencia?: string; pagina?: string; tamanhoPagina?: string };

    await app.prisma.mensalidade.updateMany({
      where: { status: "PENDENTE", vencimento: { lt: new Date() } },
      data: { status: "ATRASADO" },
    });

    const where = {
      status: query.status ? (query.status as "PAGO" | "PENDENTE" | "ATRASADO") : undefined,
      mesReferencia: query.mesReferencia,
    };
    const argsComuns = {
      where,
      include: { aluno: { include: { responsavel: true, turma: true } } },
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

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = criarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const mensalidade = await app.prisma.mensalidade.create({ data: { ...body.data, status: "PENDENTE" } });
    return reply.code(201).send(mensalidade);
  });

  app.patch("/:id/pagamento", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = pagamentoSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const mensalidade = await app.prisma.mensalidade.update({
      where: { id },
      data: {
        status: "PAGO",
        formaPagamento: body.data.formaPagamento,
        dataPagamento: body.data.dataPagamento ?? new Date(),
      },
    });
    return mensalidade;
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.mensalidade.delete({ where: { id } });
    return reply.code(204).send();
  });
}
