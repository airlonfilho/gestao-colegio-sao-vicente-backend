import { zodToJsonSchema } from "zod-to-json-schema";
import { loginSchema, perfilSchema, senhaSchema } from "../routes/auth.routes.js";
import { criarSchema as criarUsuarioSchema, atualizarSchema as atualizarUsuarioSchema } from "../routes/usuarios.routes.js";
import { schema as responsavelSchema } from "../routes/responsaveis.routes.js";
import { schema as turmaSchema } from "../routes/turmas.routes.js";
import { schema as disciplinaSchema } from "../routes/disciplinas.routes.js";
import { schema as turmaDisciplinaProfessorSchema } from "../routes/turma-disciplina-professor.routes.js";
import { schema as alunoSchema, atualizarSchema as atualizarAlunoSchema, observacaoSchema } from "../routes/alunos.routes.js";
import { schema as notaSchema } from "../routes/notas.routes.js";
import { criarSchema as criarMensalidadeSchema, pagamentoSchema as pagamentoMensalidadeSchema, gerarSchema as gerarMensalidadesSchema, editarSchema as editarMensalidadeSchema } from "../routes/mensalidades.routes.js";
import { configuracaoSchema } from "../routes/configuracoes.routes.js";
import { schema as funcionarioSchema } from "../routes/funcionarios.routes.js";
import { schema as despesaSchema } from "../routes/despesas.routes.js";
import { schema as registroFuncionarioSchema } from "../routes/registros-funcionario.routes.js";
import { enviarSchema as enviarMensagemWhatsappSchema } from "../routes/mensagens-whatsapp.routes.js";
import { conectarSchema as conectarWhatsappSchema, testeSchema as testeWhatsappSchema } from "../routes/whatsapp.routes.js";

/**
 * Converte um schema zod para JSON Schema (formato OpenAPI 3), inline (sem $ref).
 * Mantém a documentação sempre sincronizada com a validação real das rotas.
 */
function corpo(schema: Parameters<typeof zodToJsonSchema>[0]) {
  return zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" });
}

function jsonBody(schema: Parameters<typeof zodToJsonSchema>[0], descricao = "") {
  return {
    description: descricao,
    required: true,
    content: { "application/json": { schema: corpo(schema) } },
  };
}

const respostaMensagem = {
  type: "object",
  properties: { message: { type: "string" } },
};

const respostaErroValidacao = {
  type: "object",
  properties: {
    fieldErrors: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
    formErrors: { type: "array", items: { type: "string" } },
  },
};

const r400 = { description: "Erro de validação do corpo da requisição", content: { "application/json": { schema: respostaErroValidacao } } };
const r401 = { description: "Token ausente ou inválido", content: { "application/json": { schema: respostaMensagem } } };
const r403 = { description: "Perfil sem permissão para este recurso", content: { "application/json": { schema: respostaMensagem } } };
const r404 = { description: "Registro não encontrado", content: { "application/json": { schema: respostaMensagem } } };
const r409 = { description: "Conflito — já existe um registro com esse valor único", content: { "application/json": { schema: respostaMensagem } } };

const bearerAuth = [{ bearerAuth: [] }];

export const openapiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Sistema de Gestão Escolar — API",
    version: "1.0.0",
    description:
      "API do backend (Fastify + Prisma + PostgreSQL). Todas as rotas, exceto `/auth/login` e `/health`, exigem `Authorization: Bearer <token>`. " +
      "Rotas marcadas com 🔒 admin só funcionam com usuários de perfil `admin`. Veja também o `FRONTEND.md` e o `BACKEND_ROADMAP.md` na raiz do repositório.",
  },
  servers: [{ url: "http://localhost:3333", description: "Desenvolvimento local" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  tags: [
    { name: "Auth" },
    { name: "Usuários" },
    { name: "Responsáveis" },
    { name: "Turmas" },
    { name: "Disciplinas" },
    { name: "Turma-Disciplina-Professor" },
    { name: "Alunos" },
    { name: "Notas" },
    { name: "Mensalidades" },
    { name: "Configurações" },
    { name: "Funcionários" },
    { name: "Despesas" },
    { name: "Registros de Funcionário" },
    { name: "Mensagens WhatsApp" },
    { name: "Health" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Verifica se a API está no ar",
        responses: { 200: { description: "OK" } },
      },
    },

    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Autentica e retorna um token JWT (válido por 8h)",
        requestBody: jsonBody(loginSchema, "email + senha"),
        responses: {
          200: { description: "Login OK — retorna { token, usuario }" },
          400: r400,
          401: { description: "Credenciais inválidas", content: { "application/json": { schema: respostaMensagem } } },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Retorna o usuário autenticado pelo token",
        security: bearerAuth,
        responses: { 200: { description: "{ id, nome, email, perfil, foto }" }, 401: r401 },
      },
    },
    "/auth/perfil": {
      patch: {
        tags: ["Auth"],
        summary: "Atualiza a foto do próprio usuário (data URL base64 JPG/PNG/WebP; null remove)",
        security: bearerAuth,
        requestBody: jsonBody(perfilSchema),
        responses: { 200: { description: "{ id, nome, email, perfil, foto }" }, 400: r400, 401: r401, 413: { description: "Imagem grande demais" } },
      },
    },
    "/auth/senha": {
      patch: {
        tags: ["Auth"],
        summary: "Troca a senha do próprio usuário (confere a senha atual)",
        security: bearerAuth,
        requestBody: jsonBody(senhaSchema),
        responses: { 204: { description: "Senha alterada" }, 400: { description: "Senha atual incorreta ou nova senha inválida" }, 401: r401 },
      },
    },

    "/usuarios": {
      get: {
        tags: ["Usuários"],
        summary: "🔒 admin — lista todos os usuários do sistema",
        security: bearerAuth,
        responses: { 200: { description: "Lista de usuários" }, 401: r401, 403: r403 },
      },
      post: {
        tags: ["Usuários"],
        summary: "🔒 admin — cria um usuário (admin ou professor)",
        security: bearerAuth,
        requestBody: jsonBody(criarUsuarioSchema),
        responses: { 201: { description: "Usuário criado" }, 400: r400, 401: r401, 403: r403 },
      },
    },
    "/usuarios/{id}": {
      patch: {
        tags: ["Usuários"],
        summary: "🔒 admin — atualiza nome/email/senha/perfil/ativo",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(atualizarUsuarioSchema),
        responses: { 200: { description: "Usuário atualizado" }, 400: r400, 401: r401, 403: r403, 404: r404 },
      },
      delete: {
        tags: ["Usuários"],
        summary: "🔒 admin — inativa o usuário (soft delete, ativo = false)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Inativado" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/responsaveis": {
      get: {
        tags: ["Responsáveis"],
        summary: "🔒 admin — lista responsáveis com os alunos vinculados",
        security: bearerAuth,
        responses: { 200: { description: "Lista de responsáveis" }, 401: r401 },
      },
      post: {
        tags: ["Responsáveis"],
        summary: "🔒 admin — cria responsável (CPF e telefone validados)",
        security: bearerAuth,
        requestBody: jsonBody(responsavelSchema),
        responses: { 201: { description: "Responsável criado" }, 400: r400, 401: r401, 403: r403, 409: r409 },
      },
    },
    "/responsaveis/{id}": {
      get: {
        tags: ["Responsáveis"],
        summary: "🔒 admin — busca um responsável por id",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Responsável" }, 401: r401, 404: r404 },
      },
      patch: {
        tags: ["Responsáveis"],
        summary: "🔒 admin — atualiza responsável",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(responsavelSchema),
        responses: { 200: { description: "Responsável atualizado" }, 400: r400, 401: r401, 403: r403, 404: r404, 409: r409 },
      },
      delete: {
        tags: ["Responsáveis"],
        summary: "🔒 admin — exclui o responsável (hard delete)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluído" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/turmas": {
      get: {
        tags: ["Turmas"],
        summary: "Lista turmas com a contagem de alunos e o currículo (disciplinaIds). Professor recebe só as turmas e disciplinas em que leciona",
        security: bearerAuth,
        responses: { 200: { description: "Lista de turmas" }, 401: r401 },
      },
      post: {
        tags: ["Turmas"],
        summary: "🔒 admin — cria turma (disciplinaIds opcional define o currículo)",
        security: bearerAuth,
        requestBody: jsonBody(turmaSchema),
        responses: { 201: { description: "Turma criada" }, 400: r400, 401: r401, 403: r403 },
      },
    },
    "/turmas/{id}/alunos": {
      get: {
        tags: ["Turmas"],
        summary: "Lista os alunos de uma turma",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Lista de alunos da turma" }, 401: r401 },
      },
    },
    "/turmas/{id}": {
      patch: {
        tags: ["Turmas"],
        summary: "🔒 admin — atualiza turma (enviar disciplinaIds substitui o currículo inteiro)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(turmaSchema),
        responses: { 200: { description: "Turma atualizada" }, 400: r400, 401: r401, 403: r403, 404: r404 },
      },
      delete: {
        tags: ["Turmas"],
        summary: "🔒 admin — exclui turma (hard delete; 409 se tiver alunos)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluída" }, 401: r401, 403: r403, 404: r404, 409: { description: "Turma possui alunos ou outros vínculos" } },
      },
    },

    "/disciplinas": {
      get: {
        tags: ["Disciplinas"],
        summary: "Lista disciplinas (professor: só as que leciona)",
        security: bearerAuth,
        responses: { 200: { description: "Lista de disciplinas" }, 401: r401 },
      },
      post: {
        tags: ["Disciplinas"],
        summary: "🔒 admin — cria disciplina",
        security: bearerAuth,
        requestBody: jsonBody(disciplinaSchema),
        responses: { 201: { description: "Disciplina criada" }, 400: r400, 401: r401, 403: r403 },
      },
    },
    "/disciplinas/{id}": {
      patch: {
        tags: ["Disciplinas"],
        summary: "🔒 admin — atualiza disciplina (409 se o nome já existir, ignorando maiúsculas/acentos)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(disciplinaSchema),
        responses: { 200: { description: "Disciplina atualizada" }, 400: r400, 401: r401, 403: r403, 404: r404 },
      },
      delete: {
        tags: ["Disciplinas"],
        summary: "🔒 admin — exclui disciplina (hard delete)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluída" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/turma-disciplina-professor": {
      get: {
        tags: ["Turma-Disciplina-Professor"],
        summary: "Lista os vínculos turma+disciplina+professor",
        security: bearerAuth,
        responses: { 200: { description: "Lista de vínculos" }, 401: r401 },
      },
      post: {
        tags: ["Turma-Disciplina-Professor"],
        summary: "🔒 admin — vincula um professor a uma turma+disciplina (400 se a disciplina estiver fora do currículo; 409 se já houver professor)",
        security: bearerAuth,
        requestBody: jsonBody(turmaDisciplinaProfessorSchema),
        responses: { 201: { description: "Vínculo criado" }, 400: r400, 401: r401, 403: r403, 409: r409 },
      },
    },
    "/turma-disciplina-professor/{id}": {
      delete: {
        tags: ["Turma-Disciplina-Professor"],
        summary: "🔒 admin — remove o vínculo",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Removido" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/alunos": {
      get: {
        tags: ["Alunos"],
        summary: "Lista alunos (professor: só das turmas em que leciona). Por padrão só ATIVO; paginação via `pagina` é opcional (sem ela, retorna array puro)",
        security: bearerAuth,
        parameters: [
          { name: "busca", in: "query", required: false, schema: { type: "string" }, description: "Busca por nome, case-insensitive" },
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["ATIVO", "INATIVO", "TODOS"] }, description: "Padrão: ATIVO" },
          { name: "pagina", in: "query", required: false, schema: { type: "integer" }, description: "Se enviado, resposta vira { dados, total, pagina, totalPaginas }" },
          { name: "tamanhoPagina", in: "query", required: false, schema: { type: "integer" }, description: "Padrão 20, máximo 100" },
        ],
        responses: { 200: { description: "Array de alunos, ou { dados, total, pagina, totalPaginas } se `pagina` foi enviado" }, 401: r401 },
      },
      post: {
        tags: ["Alunos"],
        summary: "🔒 admin — matricula um aluno. Aceita diaVencimento e desconto (tipoDesconto, valorDesconto, motivoDesconto, descontoAte). Gera na mesma transação a MATRICULA (no período) ou a mensalidade do mês; responde com cobrancasCriadas: [{ id, tipo, mesReferencia, valor, status }]",
        security: bearerAuth,
        requestBody: jsonBody(alunoSchema),
        responses: { 201: { description: "Aluno criado" }, 400: r400, 401: r401, 403: r403 },
      },
    },
    "/alunos/{id}": {
      get: {
        tags: ["Alunos"],
        summary: "Busca um aluno por id (com turma e responsável). Para professor, os campos de desconto não vêm",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "Aluno" }, 401: r401, 404: r404 },
      },
      patch: {
        tags: ["Alunos"],
        summary: "🔒 admin — atualiza aluno. Mudar turmaId recalcula as cobranças não pagas; mudar diaVencimento/desconto só recalcula com aplicarPendentes: true. Responde com cobrancasRecalculadas",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(atualizarAlunoSchema),
        responses: { 200: { description: "Aluno atualizado" }, 400: r400, 401: r401, 403: r403, 404: r404 },
      },
      delete: {
        tags: ["Alunos"],
        summary: "🔒 admin — inativa o aluno (soft delete, status = INATIVO)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Inativado" }, 401: r401, 403: r403, 404: r404 },
      },
    },
    "/alunos/{id}/boletim": {
      get: {
        tags: ["Alunos"],
        summary: "Boletim do aluno — aluno + todas as notas por disciplina/bimestre",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 200: { description: "{ aluno (com turma.disciplinaIds), notas, observacoes: [{ anoLetivo, periodo, texto }] }" }, 401: r401, 404: r404 },
      },
      patch: {
        tags: ["Alunos"],
        summary: "🔒 admin — salva a observação do boletim para um ano letivo + período",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(observacaoSchema),
        responses: { 200: { description: "{ anoLetivo, periodo, texto }" }, 400: r400, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/notas": {
      get: {
        tags: ["Notas"],
        summary: "Lista notas (filtra por aluno opcionalmente)",
        security: bearerAuth,
        parameters: [{ name: "alunoId", in: "query", required: false, schema: { type: "integer" } }],
        responses: { 200: { description: "Lista de notas" }, 401: r401 },
      },
      post: {
        tags: ["Notas"],
        summary:
          "Lança (ou sobrescreve, via upsert) a nota de um aluno numa disciplina/bimestre/ano. Admin lança em qualquer turma/disciplina; professor só nas que leciona.",
        security: bearerAuth,
        requestBody: jsonBody(notaSchema),
        responses: {
          201: { description: "Nota criada ou atualizada" },
          400: r400,
          401: r401,
          403: { description: "Professor não leciona essa disciplina nessa turma", content: { "application/json": { schema: respostaMensagem } } },
        },
      },
    },
    "/notas/{id}": {
      delete: {
        tags: ["Notas"],
        summary: "🔒 admin — exclui a nota",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluída" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/mensalidades": {
      get: {
        tags: ["Mensalidades"],
        summary: "🔒 admin — lista cobranças (filtra por status, tipo, mês, aluno). Cada item traz tipo, valorOriginal, desconto e valor. Marca como ATRASADO as PENDENTE com vencimento antes de hoje; ISENTO nunca vira ATRASADO. Paginação via `pagina` é opcional.",
        security: bearerAuth,
        parameters: [
          { name: "status", in: "query", required: false, schema: { type: "string", enum: ["PAGO", "PENDENTE", "ATRASADO", "ISENTO"] } },
          { name: "tipo", in: "query", required: false, schema: { type: "string", enum: ["MENSALIDADE", "MATRICULA"] } },
          { name: "alunoId", in: "query", required: false, schema: { type: "integer" } },
          { name: "mesReferencia", in: "query", required: false, schema: { type: "string", example: "2026-02" } },
          { name: "pagina", in: "query", required: false, schema: { type: "integer" }, description: "Se enviado, resposta vira { dados, total, pagina, totalPaginas }" },
          { name: "tamanhoPagina", in: "query", required: false, schema: { type: "integer" }, description: "Padrão 20, máximo 100" },
        ],
        responses: { 200: { description: "Array de mensalidades, ou { dados, total, pagina, totalPaginas } se `pagina` foi enviado" }, 401: r401 },
      },
      post: {
        tags: ["Mensalidades"],
        summary: "🔒 admin — cobrança manual. `valor` é o valor cheio; aplica o desconto do aluno salvo `desconto` explícito. tipo padrão MENSALIDADE; uma MATRICULA por aluno por ano (409)",
        security: bearerAuth,
        requestBody: jsonBody(criarMensalidadeSchema),
        responses: { 201: { description: "Mensalidade criada" }, 400: r400, 401: r401, 403: r403, 409: r409 },
      },
    },
    "/mensalidades/{id}/pagamento": {
      patch: {
        tags: ["Mensalidades"],
        summary: "🔒 admin — marca a mensalidade como paga",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(pagamentoMensalidadeSchema),
        responses: { 200: { description: "Mensalidade paga" }, 400: r400, 401: r401, 403: r403, 404: r404, 409: { description: "Cobrança ISENTO não recebe pagamento" } },
      },
    },
    "/mensalidades/gerar": {
      post: {
        tags: ["Mensalidades"],
        summary: "🔒 admin — gera as mensalidades do mês para os alunos ATIVO (idempotente; funciona com a cobrança automática desligada)",
        security: bearerAuth,
        requestBody: jsonBody(gerarMensalidadesSchema),
        responses: {
          200: { description: "{ mesReferencia, criadas, jaExistiam, isentas, ignoradas: { mesSemCobranca, alunoInativo, matriculadoDepois } }" },
          400: { description: "Mês inválido, ou fora dos meses configurados (mesmo corpo, com criadas: 0 e message de aviso)" },
          401: r401, 403: r403,
        },
      },
    },
    "/mensalidades/{id}": {
      patch: {
        tags: ["Mensalidades"],
        summary: "🔒 admin — edita cobrança não paga: valor = valorOriginal − desconto; situação recalculada (ISENTO se zero)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(editarMensalidadeSchema),
        responses: { 200: { description: "Cobrança recalculada" }, 400: { description: "Desconto maior que o valor" }, 401: r401, 403: r403, 404: r404, 409: { description: "Cobrança já paga" } },
      },
      delete: {
        tags: ["Mensalidades"],
        summary: "🔒 admin — exclui a mensalidade",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluída" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/configuracoes": {
      get: {
        tags: ["Configurações"],
        summary: "🔒 admin — configuração de cobrança da escola",
        security: bearerAuth,
        responses: { 200: { description: "{ diaVencimentoPadrao, mesesCobranca, cobrancaAutomatica, cobrarMatricula, valorMatricula, diasVencimentoMatricula, periodoMatriculaAte, descontoNaMatricula, atualizadoEm }" }, 401: r401, 403: r403 },
      },
      patch: {
        tags: ["Configurações"],
        summary: "🔒 admin — altera a configuração (parcial)",
        security: bearerAuth,
        requestBody: jsonBody(configuracaoSchema),
        responses: { 200: { description: "Configuração salva" }, 400: { description: "Dia fora de 1–31, mês fora de 1–12, cobrarMatricula sem valorMatricula" }, 401: r401, 403: r403 },
      },
    },

    "/funcionarios": {
      get: {
        tags: ["Funcionários"],
        summary: "🔒 admin — lista funcionários",
        security: bearerAuth,
        responses: { 200: { description: "Lista de funcionários" }, 401: r401 },
      },
      post: {
        tags: ["Funcionários"],
        summary: "🔒 admin — cadastra funcionário (CPF validado)",
        security: bearerAuth,
        requestBody: jsonBody(funcionarioSchema),
        responses: { 201: { description: "Funcionário criado" }, 400: r400, 401: r401, 403: r403, 409: r409 },
      },
    },
    "/funcionarios/{id}": {
      patch: {
        tags: ["Funcionários"],
        summary: "🔒 admin — atualiza funcionário",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(funcionarioSchema),
        responses: { 200: { description: "Funcionário atualizado" }, 400: r400, 401: r401, 403: r403, 404: r404, 409: r409 },
      },
      delete: {
        tags: ["Funcionários"],
        summary: "🔒 admin — exclui funcionário (hard delete)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluído" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/despesas": {
      get: {
        tags: ["Despesas"],
        summary: "🔒 admin — lista despesas",
        security: bearerAuth,
        responses: { 200: { description: "Lista de despesas" }, 401: r401 },
      },
      post: {
        tags: ["Despesas"],
        summary: "🔒 admin — lança despesa",
        security: bearerAuth,
        requestBody: jsonBody(despesaSchema),
        responses: { 201: { description: "Despesa criada" }, 400: r400, 401: r401, 403: r403 },
      },
    },
    "/despesas/{id}": {
      patch: {
        tags: ["Despesas"],
        summary: "🔒 admin — edita despesa (parcial; null limpa campos opcionais)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(despesaSchema.partial()),
        responses: { 200: { description: "Registro atualizado" }, 400: r400, 401: r401, 403: r403, 404: r404 },
      },
      delete: {
        tags: ["Despesas"],
        summary: "🔒 admin — exclui despesa",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluída" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/registros-funcionario": {
      get: {
        tags: ["Registros de Funcionário"],
        summary: "🔒 admin — lista registros (histórico livre por funcionário)",
        security: bearerAuth,
        responses: { 200: { description: "Lista de registros" }, 401: r401 },
      },
      post: {
        tags: ["Registros de Funcionário"],
        summary: "🔒 admin — cria um registro",
        security: bearerAuth,
        requestBody: jsonBody(registroFuncionarioSchema),
        responses: { 201: { description: "Registro criado" }, 400: r400, 401: r401, 403: r403 },
      },
    },
    "/registros-funcionario/{id}": {
      patch: {
        tags: ["Registros de Funcionário"],
        summary: "🔒 admin — edita registro (parcial; null limpa campos opcionais)",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: jsonBody(registroFuncionarioSchema.partial()),
        responses: { 200: { description: "Registro atualizado" }, 400: r400, 401: r401, 403: r403, 404: r404 },
      },
      delete: {
        tags: ["Registros de Funcionário"],
        summary: "🔒 admin — exclui o registro",
        security: bearerAuth,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { 204: { description: "Excluído" }, 401: r401, 403: r403, 404: r404 },
      },
    },

    "/mensagens-whatsapp": {
      get: {
        tags: ["Mensagens WhatsApp"],
        summary: "🔒 admin — lista o histórico de mensagens (com aluno + responsável)",
        security: bearerAuth,
        responses: { 200: { description: "Lista de mensagens" }, 401: r401, 403: r403 },
      },
    },
    "/mensagens-whatsapp/enviar": {
      post: {
        tags: ["Mensagens WhatsApp"],
        summary: "🔒 admin — envia uma mensagem ao responsável do aluno pelo WhatsApp da escola (Evolution API)",
        security: bearerAuth,
        requestBody: jsonBody(enviarMensagemWhatsappSchema),
        responses: {
          201: { description: "Mensagem enviada e registrada" },
          400: r400,
          401: r401,
          403: r403,
          404: r404,
          502: { description: "WhatsApp desconectado ou Evolution API indisponível (o registro fica com status ERRO e `message` explica)", content: { "application/json": { schema: respostaMensagem } } },
        },
      },
    },

    "/whatsapp/status": {
      get: {
        tags: ["WhatsApp"],
        summary: "🔒 admin — estado da conexão: conectado | conectando | desconectado | indisponivel (sempre 200; `configurado: false` sem EVOLUTION_API_URL/KEY)",
        security: bearerAuth,
        responses: { 200: { description: "{ configurado, estado, numero?, nome?, foto?, erro? }" }, 401: r401, 403: r403 },
      },
    },
    "/whatsapp/conectar": {
      post: {
        tags: ["WhatsApp"],
        summary: "🔒 admin — inicia a conexão: devolve o QR Code (data URL). Com `numero`, devolve também o código de pareamento",
        security: bearerAuth,
        requestBody: jsonBody(conectarWhatsappSchema),
        responses: {
          200: { description: "{ estado: 'conectando', qrcode?, codigoPareamento? } ou { estado: 'conectado' }" },
          400: r400, 401: r401, 403: r403,
          502: { description: "Evolution API indisponível ou recusou", content: { "application/json": { schema: respostaMensagem } } },
          503: { description: "WhatsApp não configurado no servidor", content: { "application/json": { schema: respostaMensagem } } },
        },
      },
    },
    "/whatsapp/desconectar": {
      post: {
        tags: ["WhatsApp"],
        summary: "🔒 admin — desconecta o número da escola (logout); conectar de novo exige novo QR Code",
        security: bearerAuth,
        responses: { 204: { description: "Desconectado" }, 401: r401, 403: r403, 502: { description: "Evolution API indisponível", content: { "application/json": { schema: respostaMensagem } } } },
      },
    },
    "/whatsapp/teste": {
      post: {
        tags: ["WhatsApp"],
        summary: "🔒 admin — envia uma mensagem de teste para um telefone",
        security: bearerAuth,
        requestBody: jsonBody(testeWhatsappSchema),
        responses: { 200: { description: "{ enviado: true }" }, 400: r400, 401: r401, 403: r403, 502: { description: "Falha no envio", content: { "application/json": { schema: respostaMensagem } } } },
      },
    },
  },
};
