import { FastifyInstance } from "fastify";
import { z } from "zod";
import { compararSenha, hashSenha } from "../utils/hash.js";
import { fotoOpcional } from "../utils/zod.js";

export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

export const perfilSchema = z.object({
  foto: fotoOpcional,
});

export const senhaSchema = z.object({
  senhaAtual: z.string().min(1),
  novaSenha: z.string().min(6, { message: "A nova senha precisa ter pelo menos 6 caracteres." }),
});

const camposPublicos = { id: true, nome: true, email: true, perfil: true, foto: true } as const;

export default async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ message: "email e senha são obrigatórios" });
    }

    const usuario = await app.prisma.usuario.findUnique({ where: { email: body.data.email } });
    if (!usuario || !usuario.ativo) {
      return reply.code(401).send({ message: "Credenciais inválidas" });
    }

    const senhaOk = await compararSenha(body.data.senha, usuario.senhaHash);
    if (!senhaOk) {
      return reply.code(401).send({ message: "Credenciais inválidas" });
    }

    const token = app.jwt.sign({ id: usuario.id, perfil: usuario.perfil }, { expiresIn: "8h" });

    return reply.send({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, foto: usuario.foto },
    });
  });

  app.get("/me", { preHandler: app.authenticate }, async (request) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { id: request.user.id },
      select: camposPublicos,
    });
    return usuario;
  });

  /** Atualiza a foto do próprio usuário. `foto: null` remove. */
  app.patch("/perfil", { preHandler: app.authenticate }, async (request, reply) => {
    const body = perfilSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    return app.prisma.usuario.update({
      where: { id: request.user.id },
      data: { foto: body.data.foto ?? null },
      select: camposPublicos,
    });
  });

  /** Troca a senha do próprio usuário, conferindo a senha atual. */
  app.patch("/senha", { preHandler: app.authenticate }, async (request, reply) => {
    const body = senhaSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(body.error.flatten());

    const usuario = await app.prisma.usuario.findUnique({ where: { id: request.user.id } });
    if (!usuario || !usuario.ativo) return reply.code(401).send({ message: "Token inválido ou ausente" });

    if (!(await compararSenha(body.data.senhaAtual, usuario.senhaHash))) {
      return reply.code(400).send({ message: "A senha atual está incorreta." });
    }

    await app.prisma.usuario.update({
      where: { id: usuario.id },
      data: { senhaHash: await hashSenha(body.data.novaSenha) },
    });
    return reply.code(204).send();
  });
}
