import { FastifyInstance } from "fastify";
import { z } from "zod";

export const schema = z.object({
  nome: z.string().min(1),
  nivelEnsino: z.string().min(1),
  sala: z.string().optional(),
  anoLetivo: z.number().int(),
  valorMensalidade: z.number().positive(),
});

export default async function turmasRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async () => {
    return app.prisma.turma.findMany({
      include: { _count: { select: { alunos: true } } },
      orderBy: { nome: "asc" },
    });
  });

  app.get("/:id/alunos", async (request) => {
    const id = Number((request.params as { id: string }).id);
    return app.prisma.aluno.findMany({ where: { turmaId: id }, include: { responsavel: true } });
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const turma = await app.prisma.turma.create({ data: body.data });
    return reply.code(201).send(turma);
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    return app.prisma.turma.update({ where: { id }, data: body.data });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.turma.delete({ where: { id } });
    return reply.code(204).send();
  });
}
