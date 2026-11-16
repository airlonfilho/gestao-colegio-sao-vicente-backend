import { FastifyInstance } from "fastify";
import { z } from "zod";
import { cpfValido, somenteDigitos } from "../utils/validadores.js";

export const schema = z.object({
  nome: z.string().min(1),
  cargo: z.string().min(1),
  cpf: z
    .string()
    .refine(cpfValido, { message: "CPF inválido" })
    .transform(somenteDigitos),
  dataAdmissao: z.coerce.date().optional(),
});

export default async function funcionariosRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async () => app.prisma.funcionario.findMany({ orderBy: { nome: "asc" } }));

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const funcionario = await app.prisma.funcionario.create({ data: body.data });
    return reply.code(201).send(funcionario);
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    return app.prisma.funcionario.update({ where: { id }, data: body.data });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.funcionario.delete({ where: { id } });
    return reply.code(204).send();
  });
}
