import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarDisciplina, criarResponsavel, criarAluno } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

let token: string;

beforeEach(async () => {
  await limparBanco(prisma);
  await criarUsuario(prisma, { email: "admin@teste.com", perfil: "admin" });
  token = await logar(app, "admin@teste.com");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const turmaBase = { nome: "6º Ano A", nivelEnsino: "Fundamental II", anoLetivo: 2026, valorMensalidade: 800 };

function req(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
  return app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

describe("Currículo da turma (disciplinaIds)", () => {
  it("cria turma com disciplinaIds e devolve o currículo no GET /turmas", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const port = await criarDisciplina(prisma, "Português");

    const criada = await req("POST", "/turmas", { ...turmaBase, disciplinaIds: [port.id, mat.id, mat.id] });
    expect(criada.statusCode).toBe(201);
    expect(criada.json().disciplinaIds).toEqual([mat.id, port.id].sort((a, b) => a - b));

    const lista = await req("GET", "/turmas");
    expect(lista.json()[0].disciplinaIds).toHaveLength(2);
  });

  it("cria turma sem disciplinaIds com currículo vazio", async () => {
    const criada = await req("POST", "/turmas", turmaBase);
    expect(criada.statusCode).toBe(201);
    expect(criada.json().disciplinaIds).toEqual([]);
  });

  it("recusa disciplina inexistente com 400", async () => {
    const resposta = await req("POST", "/turmas", { ...turmaBase, disciplinaIds: [999999] });
    expect(resposta.statusCode).toBe(400);
  });

  it("PATCH com disciplinaIds substitui o currículo; sem o campo, mantém", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const port = await criarDisciplina(prisma, "Português");
    const turma = (await req("POST", "/turmas", { ...turmaBase, disciplinaIds: [mat.id] })).json();

    const trocada = await req("PATCH", `/turmas/${turma.id}`, { disciplinaIds: [port.id] });
    expect(trocada.json().disciplinaIds).toEqual([port.id]);

    const soSala = await req("PATCH", `/turmas/${turma.id}`, { sala: "12" });
    expect(soSala.json().disciplinaIds).toEqual([port.id]);

    const vazia = await req("PATCH", `/turmas/${turma.id}`, { disciplinaIds: [] });
    expect(vazia.json().disciplinaIds).toEqual([]);
  });

  it("boletim devolve aluno.turma.disciplinaIds", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const turma = (await req("POST", "/turmas", { ...turmaBase, disciplinaIds: [mat.id] })).json();
    const resp = await criarResponsavel(prisma, "curriculo");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });

    const boletim = await req("GET", `/alunos/${aluno.id}/boletim`);
    expect(boletim.statusCode).toBe(200);
    expect(boletim.json().aluno.turma.disciplinaIds).toEqual([mat.id]);
  });

  it("nota em disciplina fora do currículo da turma é recusada com 400", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const artes = await criarDisciplina(prisma, "Artes");
    const turma = (await req("POST", "/turmas", { ...turmaBase, disciplinaIds: [mat.id] })).json();
    const resp = await criarResponsavel(prisma, "nota");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });
    const nota = { alunoId: aluno.id, bimestre: 1, anoLetivo: 2026, nota: 8 };

    expect((await req("POST", "/notas", { ...nota, disciplinaId: artes.id })).statusCode).toBe(400);
    expect((await req("POST", "/notas", { ...nota, disciplinaId: mat.id })).statusCode).toBe(201);
    // Outro ano letivo não é validado contra o currículo atual da turma.
    expect((await req("POST", "/notas", { ...nota, anoLetivo: 2025, disciplinaId: artes.id })).statusCode).toBe(201);
  });

  it("excluir disciplina que está em um currículo retorna 409; excluir a turma limpa o currículo", async () => {
    const mat = await criarDisciplina(prisma, "Matemática");
    const turma = (await req("POST", "/turmas", { ...turmaBase, disciplinaIds: [mat.id] })).json();

    expect((await req("DELETE", `/disciplinas/${mat.id}`)).statusCode).toBe(409);
    expect((await req("DELETE", `/turmas/${turma.id}`)).statusCode).toBe(204);
    expect((await req("DELETE", `/disciplinas/${mat.id}`)).statusCode).toBe(204);
  });
});
