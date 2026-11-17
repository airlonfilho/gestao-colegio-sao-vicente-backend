import { FastifyInstance } from "fastify";
import { z } from "zod";

export const schema = z.object({
  titulo: z.string().min(1),
  categoria: z.string().min(1),
  funcionarioId: z.number().int(),
  formaPagamento: z.enum(["PIX", "BOLETO", "CARTAO", "DINHEIRO", "FOLHA_PAGAMENTO"]),
  valor: z.number().positive(),
  data: z.coerce.date(),
});

export default async function despesasRoutes(app: FastifyInstance) {
  // Dados financeiros e de RH: só admin (LGPD — professor não usa essas telas).
  app.addHook("preHandler", app.authorize(["admin"]));

  app.get("/", async () => {
    return app.prisma.despesa.findMany({
      include: { funcionario: { select: { id: true, nome: true, cargo: true } } },
      orderBy: { data: "desc" },
    });
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const despesa = await app.prisma.despesa.create({ data: body.data });
    return reply.code(201).send(despesa);
  });

  // Edição parcial: só os campos enviados mudam. 404 (via P2025) se não existir.
  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    return app.prisma.despesa.update({ where: { id }, data: body.data });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.despesa.delete({ where: { id } });
    return reply.code(204).send();
  });
}
