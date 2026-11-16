import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Prisma } from "@prisma/client";

import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import { openapiDocument } from "./docs/openapi.js";

import authRoutes from "./routes/auth.routes.js";
import usuariosRoutes from "./routes/usuarios.routes.js";
import responsaveisRoutes from "./routes/responsaveis.routes.js";
import turmasRoutes from "./routes/turmas.routes.js";
import disciplinasRoutes from "./routes/disciplinas.routes.js";
import turmaDisciplinaProfessorRoutes from "./routes/turma-disciplina-professor.routes.js";
import alunosRoutes from "./routes/alunos.routes.js";
import notasRoutes from "./routes/notas.routes.js";
import mensalidadesRoutes from "./routes/mensalidades.routes.js";
import funcionariosRoutes from "./routes/funcionarios.routes.js";
import despesasRoutes from "./routes/despesas.routes.js";
import registrosFuncionarioRoutes from "./routes/registros-funcionario.routes.js";
import mensagensWhatsappRoutes from "./routes/mensagens-whatsapp.routes.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(prismaPlugin);
  app.register(authPlugin);

  app.register(swagger, { mode: "static", specification: { document: openapiDocument as any } });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return reply.code(409).send({ message: "Já existe um registro com esse valor único (ex.: e-mail ou CPF duplicado)" });
      }
      if (error.code === "P2025") {
        return reply.code(404).send({ message: "Registro não encontrado" });
      }
    }

    app.log.error(error);
    return reply.code(error.statusCode ?? 500).send({ message: "Erro interno no servidor" });
  });

  app.register(authRoutes, { prefix: "/auth" });
  app.register(usuariosRoutes, { prefix: "/usuarios" });
  app.register(responsaveisRoutes, { prefix: "/responsaveis" });
  app.register(turmasRoutes, { prefix: "/turmas" });
  app.register(disciplinasRoutes, { prefix: "/disciplinas" });
  app.register(turmaDisciplinaProfessorRoutes, { prefix: "/turma-disciplina-professor" });
  app.register(alunosRoutes, { prefix: "/alunos" });
  app.register(notasRoutes, { prefix: "/notas" });
  app.register(mensalidadesRoutes, { prefix: "/mensalidades" });
  app.register(funcionariosRoutes, { prefix: "/funcionarios" });
  app.register(despesasRoutes, { prefix: "/despesas" });
  app.register(registrosFuncionarioRoutes, { prefix: "/registros-funcionario" });
  app.register(mensagensWhatsappRoutes, { prefix: "/mensagens-whatsapp" });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
