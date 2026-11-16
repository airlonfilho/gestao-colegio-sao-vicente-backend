import { FastifyInstance } from "fastify";
import { z } from "zod";
import { lerPaginacao, paginar } from "../utils/paginacao.js";

export const schema = z.object({
  nome: z.string().min(1),
  dataNascimento: z.coerce.date().optional(),
  turmaId: z.number().int(),
  responsavelId: z.number().int(),
  status: z.enum(["ATIVO", "INATIVO"]).optional(),
});

export default async function alunosRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = request.query as { busca?: string; status?: string; pagina?: string; tamanhoPagina?: string };

    const where = {
      ...(query.busca ? { nome: { contains: query.busca, mode: "insensitive" as const } } : {}),
      ...(query.status === "TODOS" ? {} : { status: (query.status as "ATIVO" | "INATIVO") ?? "ATIVO" }),
    };

    const argsComuns = { where, include: { turma: true, responsavel: true }, orderBy: { nome: "asc" as const } };

    const paginacao = lerPaginacao(query);
    if (!paginacao) {
      return app.prisma.aluno.findMany(argsComuns);
    }

    const [dados, total] = await Promise.all([
      app.prisma.aluno.findMany({ ...argsComuns, skip: paginacao.skip, take: paginacao.take }),
      app.prisma.aluno.count({ where }),
    ]);
    return paginar(dados, total, paginacao);
  });

  app.get("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const aluno = await app.prisma.aluno.findUnique({
      where: { id },
      include: { turma: true, responsavel: true },
    });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });
    return aluno;
  });

  app.get("/:id/boletim", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const aluno = await app.prisma.aluno.findUnique({ where: { id }, include: { turma: true } });
    if (!aluno) return reply.code(404).send({ message: "Aluno não encontrado" });

    const notas = await app.prisma.nota.findMany({
      where: { alunoId: id },
      include: { disciplina: true },
      orderBy: [{ disciplina: { nome: "asc" } }, { bimestre: "asc" }],
    });

    return { aluno, notas };
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const aluno = await app.prisma.aluno.create({ data: body.data });
    return reply.code(201).send(aluno);
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    return app.prisma.aluno.update({ where: { id }, data: body.data });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.aluno.update({ where: { id }, data: { status: "INATIVO" } });
    return reply.code(204).send();
  });
}
