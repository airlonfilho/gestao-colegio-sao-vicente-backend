import fp from "fastify-plugin";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";

export default fp(async (fastify: FastifyInstance) => {
  fastify.register(jwt, {
    secret: process.env.JWT_SECRET ?? "troque-esse-segredo-em-producao",
  });

  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ message: "Token inválido ou ausente" });
    }
  });

  fastify.decorate("authorize", (perfis: Array<"admin" | "professor">) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;

      if (!perfis.includes(request.user.perfil)) {
        reply.code(403).send({ message: "Sem permissão para este recurso" });
      }
    };
  });
});
