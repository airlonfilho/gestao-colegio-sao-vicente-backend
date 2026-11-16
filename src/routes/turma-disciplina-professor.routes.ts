import { FastifyInstance } from "fastify";
import { z } from "zod";

export const schema = z.object({
  turmaId: z.number().int(),
  disciplinaId: z.number().int(),
  usuarioId: z.number().int(),
});

export default async function turmaDisciplinaProfessorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async () => {
    return app.prisma.turmaDisciplinaProfessor.findMany({
      include: { turma: true, disciplina: true, professor: { select: { id: true, nome: true } } },
    });
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const vinculo = await app.prisma.turmaDisciplinaProfessor.create({ data: body.data });
    return reply.code(201).send(vinculo);
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.turmaDisciplinaProfessor.delete({ where: { id } });
    return reply.code(204).send();
  });
}
