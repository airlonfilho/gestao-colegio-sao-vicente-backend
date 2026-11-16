import { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashSenha } from "../utils/hash.js";

export const criarSchema = z.object({
  nome: z.string().min(1),
  email: z.string().email(),
  senha: z.string().min(6),
  perfil: z.enum(["admin", "professor"]),
});

export const atualizarSchema = z.object({
  nome: z.string().min(1).optional(),
  email: z.string().email().optional(),
  senha: z.string().min(6).optional(),
  perfil: z.enum(["admin", "professor"]).optional(),
  ativo: z.boolean().optional(),
});

export default async function usuariosRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.authorize(["admin"]));

  app.get("/", async () => {
    return app.prisma.usuario.findMany({
      select: { id: true, nome: true, email: true, perfil: true, ativo: true, criadoEm: true },
      orderBy: { nome: "asc" },
    });
  });

  app.post("/", async (request, reply) => {
    const body = criarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const senhaHash = await hashSenha(body.data.senha);
    const usuario = await app.prisma.usuario.create({
      data: { nome: body.data.nome, email: body.data.email, perfil: body.data.perfil, senhaHash },
      select: { id: true, nome: true, email: true, perfil: true, ativo: true },
    });
    return reply.code(201).send(usuario);
  });

  app.patch("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = atualizarSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const { senha, ...resto } = body.data;
    const usuario = await app.prisma.usuario.update({
      where: { id },
      data: { ...resto, ...(senha ? { senhaHash: await hashSenha(senha) } : {}) },
      select: { id: true, nome: true, email: true, perfil: true, ativo: true },
    });
    return usuario;
  });

  app.delete("/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await app.prisma.usuario.update({ where: { id }, data: { ativo: false } });
    return reply.code(204).send();
  });
}
