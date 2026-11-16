import { FastifyInstance } from "fastify";
import { z } from "zod";
import { cpfValido, somenteDigitos, telefoneValido } from "../utils/validadores.js";

export const schema = z.object({
  nome: z.string().min(1),
  cpf: z
    .string()
    .refine(cpfValido, { message: "CPF inválido" })
    .transform(somenteDigitos),
  telefone: z
    .string()
    .refine(telefoneValido, { message: "Telefone inválido (use DDD + número)" })
    .transform(somenteDigitos),
  email: z.string().email().optional(),
  endereco: z.string().optional(),
});

export default async function responsaveisRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async () => {
    return app.prisma.responsavel.findMany({
      include: { alunos: { select: { id: true, nome: true } } },
      orderBy: { nome: "asc" },
    });
  });

  app.get("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const responsavel = await app.prisma.responsavel.findUnique({
      where: { id },
      include: { alunos: { select: { id: true, nome: true } } },
    });
    if (!responsavel) return reply.code(404).send({ message: "Responsável não encontrado" });
    return responsavel;
  });

  app.post("/", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const body = schema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    const responsavel = await app.prisma.responsavel.create({ data: body.data });
    return reply.code(201).send(responsavel);
  });

  app.patch("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = schema.partial().safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());
    return app.prisma.responsavel.update({ where: { id }, data: body.data });
  });

  app.delete("/:id", { preHandler: app.authorize(["admin"]) }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.responsavel.delete({ where: { id } });
    return reply.code(204).send();
  });
}
