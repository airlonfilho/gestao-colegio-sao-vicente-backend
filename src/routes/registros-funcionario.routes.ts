import { FastifyInstance } from "fastify";
import { z } from "zod";

export const schema = z.object({
  funcionarioId: z.number().int(),
  tipo: z.string().min(1),
  descricao: z.string().optional(),
  valor: z.number().positive(),
  data: z.coerce.date(),
});

export default async function registrosFuncionarioRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async () => {
    return app.prisma.registroFuncionario.findMany({
      include: { funcionario: { select: { id: true, nome: true } } },
      orderBy: { data: "desc" },
    });
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const registro = await app.prisma.registroFuncionario.create({ data: body.data });
    return reply.code(201).send(registro);
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.registroFuncionario.delete({ where: { id } });
    return reply.code(204).send();
  });
}
