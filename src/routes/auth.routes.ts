import { FastifyInstance } from "fastify";
import { z } from "zod";
import { compararSenha } from "../utils/hash.js";

export const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

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
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
    });
  });

  app.get("/me", { preHandler: app.authenticate }, async (request) => {
    const usuario = await app.prisma.usuario.findUnique({
      where: { id: request.user.id },
      select: { id: true, nome: true, email: true, perfil: true },
    });
    return usuario;
  });
}
