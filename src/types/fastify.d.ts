import "fastify";
import { PrismaClient } from "@prisma/client";

type Perfil = "admin" | "professor";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (perfis: Perfil[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyJWT {
    payload: { id: number; perfil: Perfil };
    user: { id: number; perfil: Perfil };
  }
}
