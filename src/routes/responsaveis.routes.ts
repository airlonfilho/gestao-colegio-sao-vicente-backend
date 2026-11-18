import { FastifyInstance } from "fastify";
import { z } from "zod";
import { cpfValido, somenteDigitos, telefoneValido } from "../utils/validadores.js";
import { emailOpcional, textoOpcional } from "../utils/zod.js";
import { camposResponsavel } from "../utils/privacidade.js";

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
  email: emailOpcional,
  endereco: textoOpcional,
});

export default async function responsaveisRoutes(app: FastifyInstance) {
  // Contatos das famílias e mensagens: só admin (o professor não usa essas telas).
  app.addHook("preHandler", app.authorize(["admin"]));

  // Professor recebe só id, nome e alunos (LGPD); admin recebe o cadastro completo.
  app.get("/", async (request) => {
    return app.prisma.responsavel.findMany({
      select: camposResponsavel(request.user.perfil),
      orderBy: { nome: "asc" },
    });
  });

  app.get("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const responsavel = await app.prisma.responsavel.findUnique({
      where: { id },
      select: camposResponsavel(request.user.perfil),
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
