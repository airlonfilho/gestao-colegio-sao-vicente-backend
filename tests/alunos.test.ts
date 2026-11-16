import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarTurma, criarResponsavel, criarAluno } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

beforeEach(async () => {
  await limparBanco(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /alunos", () => {
  it("por padrão não lista alunos inativos", async () => {
    await criarUsuario(prisma, { email: "admin@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin@teste.com");
    const turma = await criarTurma(prisma);
    const responsavel = await criarResponsavel(prisma, "a1");

    await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id, nome: "Ativo", status: "ATIVO" });
    await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id, nome: "Inativo", status: "INATIVO" });

    const resposta = await app.inject({ method: "GET", url: "/alunos", headers: { authorization: `Bearer ${token}` } });
    const alunos = JSON.parse(resposta.body);

    expect(alunos).toHaveLength(1);
    expect(alunos[0].nome).toBe("Ativo");
  });

  it("com status=TODOS lista ativos e inativos", async () => {
    await criarUsuario(prisma, { email: "admin2@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin2@teste.com");
    const turma = await criarTurma(prisma);
    const responsavel = await criarResponsavel(prisma, "a2");

    await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id, nome: "Ativo", status: "ATIVO" });
    await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id, nome: "Inativo", status: "INATIVO" });

    const resposta = await app.inject({
      method: "GET",
      url: "/alunos?status=TODOS",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(JSON.parse(resposta.body)).toHaveLength(2);
  });

  it("sem o parâmetro `pagina`, retorna um array puro (contrato antigo mantido)", async () => {
    await criarUsuario(prisma, { email: "admin3@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin3@teste.com");

    const resposta = await app.inject({ method: "GET", url: "/alunos", headers: { authorization: `Bearer ${token}` } });
    expect(Array.isArray(JSON.parse(resposta.body))).toBe(true);
  });

  it("com `pagina`, retorna { dados, total, pagina, totalPaginas }", async () => {
    await criarUsuario(prisma, { email: "admin4@teste.com", senha: "123456", perfil: "admin" });
    const token = await logar(app, "admin4@teste.com");
    const turma = await criarTurma(prisma);
    const responsavel = await criarResponsavel(prisma, "a4");

    await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id, nome: "Aluno 1" });
    await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id, nome: "Aluno 2" });
    await criarAluno(prisma, { turmaId: turma.id, responsavelId: responsavel.id, nome: "Aluno 3" });

    const resposta = await app.inject({
      method: "GET",
      url: "/alunos?pagina=1&tamanhoPagina=2",
      headers: { authorization: `Bearer ${token}` },
    });
    const corpo = JSON.parse(resposta.body);

    expect(corpo.total).toBe(3);
    expect(corpo.dados).toHaveLength(2);
    expect(corpo.totalPaginas).toBe(2);
    expect(corpo.pagina).toBe(1);
  });
});
