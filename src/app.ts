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
import configuracoesRoutes from "./routes/configuracoes.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";

/**
 * Mensagem de duplicidade (P2002) específica do recurso, em vez de uma genérica.
 * Decide pela rota e, quando ajuda, pelos campos do índice único (`meta.target`).
 */
export function mensagemDuplicidade(url: string, target: unknown) {
  const campos = (Array.isArray(target) ? target : [String(target ?? "")]).join(",");
  const recurso = url.split("?")[0].split("/")[1] ?? "";

  if (campos.includes("email") || recurso === "usuarios") return "Já existe um usuário com esse e-mail.";
  if (campos.includes("cpf") || recurso === "responsaveis" || recurso === "funcionarios") {
    return "Já existe um cadastro com esse CPF.";
  }
  if (recurso === "turma-disciplina-professor") return "Essa disciplina já tem professor vinculado nessa turma.";
  if (recurso === "mensalidades") return "Já existe mensalidade desse aluno para esse mês.";
  if (recurso === "disciplinas" || campos.includes("nome_normalizado")) return "Já existe uma disciplina com esse nome.";
  if (recurso === "turmas") return "Essa disciplina já está no currículo da turma.";
  return "Já existe um registro com esses dados.";
}

export function buildApp() {
  // bodyLimit maior que o padrão (1 MB) para aceitar fotos em base64 (até ~3 MB de imagem).
  const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

  app.register(cors, { origin: true });
  app.register(prismaPlugin);
  app.register(authPlugin);

  app.register(swagger, { mode: "static", specification: { document: openapiDocument as any } });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return reply.code(409).send({ message: mensagemDuplicidade(_request.url, error.meta?.target) });
      }
      if (error.code === "P2025") {
        return reply.code(404).send({ message: "Registro não encontrado" });
      }
      if (error.code === "P2003") {
        // Violação de chave estrangeira: na exclusão, o registro ainda é usado em outro lugar;
        // na criação/edição, o ID referenciado não existe.
        return _request.method === "DELETE"
          ? reply.code(409).send({ message: "Não é possível excluir: o registro está vinculado a outros dados" })
          : reply.code(400).send({ message: "Referência inválida: um dos registros informados não existe" });
      }
    }

    if (error.statusCode === 413) {
      return reply.code(413).send({ message: "Arquivo muito grande. Envie uma imagem de até 3 MB." });
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
  app.register(configuracoesRoutes, { prefix: "/configuracoes" });
  app.register(whatsappRoutes, { prefix: "/whatsapp" });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
