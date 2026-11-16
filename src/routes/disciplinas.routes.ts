import { FastifyInstance } from "fastify";
import { z } from "zod";

export const schema = z.object({ nome: z.string().min(1) });

export default async function disciplinasRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async () => app.prisma.disciplina.findMany({ orderBy: { nome: "asc" } }));

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const disciplina = await app.prisma.disciplina.create({ data: body.data });
    return reply.code(201).send(disciplina);
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    return app.prisma.disciplina.update({ where: { id }, data: body.data });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.disciplina.delete({ where: { id } });
    return reply.code(204).send();
  });
}
