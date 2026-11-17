import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarTurma, criarResponsavel, criarAluno } from "./helpers/fixtures.js";

/** Contrato que o frontend usa: null limpa campos opcionais, "" em datas, fotos, senha e observações. */

const prisma = new PrismaClient();
const app = buildApp();

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let admin: string;
let professor: string;

beforeEach(async () => {
  await limparBanco(prisma);
  await criarUsuario(prisma, { email: "admin@teste.com", perfil: "admin" });
  await criarUsuario(prisma, { email: "prof@teste.com", perfil: "professor" });
  admin = await logar(app, "admin@teste.com");
  professor = await logar(app, "prof@teste.com");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function req(token: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) {
  return app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

describe("null limpa campos opcionais na edição", () => {
  it("responsáveis: email e endereco", async () => {
    const criado = await req(admin, "POST", "/responsaveis", {
      nome: "Resp", cpf: "52998224725", telefone: "86999998888", email: "r@x.com", endereco: "Rua A",
    });
    expect(criado.statusCode).toBe(201);

    const editado = await req(admin, "PATCH", `/responsaveis/${criado.json().id}`, { email: null, endereco: null });
    expect(editado.statusCode).toBe(200);
    expect(editado.json()).toMatchObject({ email: null, endereco: null });
  });

  it("turmas: sala", async () => {
    const turma = await criarTurma(prisma);
    await prisma.turma.update({ where: { id: turma.id }, data: { sala: "10" } });
    const editado = await req(admin, "PATCH", `/turmas/${turma.id}`, { sala: null });
    expect(editado.statusCode).toBe(200);
    expect(editado.json().sala).toBeNull();
  });

  it("funcionários: dataAdmissao null vira null (não 1970)", async () => {
    const criado = await req(admin, "POST", "/funcionarios", {
      nome: "Func", cargo: "Secretaria", cpf: "11144477735", dataAdmissao: "2025-01-10",
    });
    const editado = await req(admin, "PATCH", `/funcionarios/${criado.json().id}`, { dataAdmissao: null });
    expect(editado.statusCode).toBe(200);
    expect(editado.json().dataAdmissao).toBeNull();
  });

  it("alunos: dataNascimento", async () => {
    const turma = await criarTurma(prisma);
    const resp = await criarResponsavel(prisma, "a");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });
    await req(admin, "PATCH", `/alunos/${aluno.id}`, { dataNascimento: "2015-03-10" });

    const editado = await req(admin, "PATCH", `/alunos/${aluno.id}`, { dataNascimento: null });
    expect(editado.statusCode).toBe(200);
    expect(editado.json().dataNascimento).toBeNull();
  });

  it("registros-funcionario: descricao null é aceito", async () => {
    const func = await prisma.funcionario.create({ data: { nome: "F", cargo: "X", cpf: "93541134780" } });
    const criado = await req(admin, "POST", "/registros-funcionario", {
      funcionarioId: func.id, tipo: "VALE", descricao: null, valor: 100, data: "2026-11-10",
    });
    expect(criado.statusCode).toBe(201);
    expect(criado.json().descricao).toBeNull();
  });
});

describe("PATCH /mensalidades/:id/pagamento", () => {
  it('dataPagamento "" é tratado como ausente (usa a data de hoje)', async () => {
    const turma = await criarTurma(prisma);
    const resp = await criarResponsavel(prisma, "m");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });
    const m = await prisma.mensalidade.create({
      data: { alunoId: aluno.id, mesReferencia: "2026-03", valor: 900, valorOriginal: 900, vencimento: new Date("2026-03-05") },
    });

    const pago = await req(admin, "PATCH", `/mensalidades/${m.id}/pagamento`, { formaPagamento: "PIX", dataPagamento: "" });
    expect(pago.statusCode).toBe(200);
    expect(pago.json().status).toBe("PAGO");
    expect(new Date(pago.json().dataPagamento).getFullYear()).toBeGreaterThan(2000);
  });
});

describe("Foto de perfil e troca de senha", () => {
  it("PATCH /auth/perfil salva a foto, e /auth/me e /auth/login a devolvem; null remove", async () => {
    const salvo = await req(professor, "PATCH", "/auth/perfil", { foto: PNG });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.json().foto).toBe(PNG);

    expect((await req(professor, "GET", "/auth/me")).json().foto).toBe(PNG);
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "prof@teste.com", senha: "123456" } });
    expect(login.json().usuario.foto).toBe(PNG);

    const removido = await req(professor, "PATCH", "/auth/perfil", { foto: null });
    expect(removido.json().foto).toBeNull();
  });

  it("recusa foto que não é imagem", async () => {
    const r = await req(professor, "PATCH", "/auth/perfil", { foto: "data:text/html;base64,PGgxPm9pPC9oMT4=" });
    expect(r.statusCode).toBe(400);
  });

  it("PATCH /auth/senha troca a senha com a senha atual correta", async () => {
    const errada = await req(professor, "PATCH", "/auth/senha", { senhaAtual: "xxxxxx", novaSenha: "nova123" });
    expect(errada.statusCode).toBe(400);

    const ok = await req(professor, "PATCH", "/auth/senha", { senhaAtual: "123456", novaSenha: "nova123" });
    expect(ok.statusCode).toBe(204);

    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "prof@teste.com", senha: "nova123" } });
    expect(login.statusCode).toBe(200);
  });
});

describe("Observações do boletim e foto do aluno", () => {
  async function aluno() {
    const turma = await criarTurma(prisma);
    const resp = await criarResponsavel(prisma, "b");
    return criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });
  }

  it("admin salva observação e o GET do boletim devolve observacoes", async () => {
    const a = await aluno();
    const payload = { anoLetivo: 2026, periodo: "1", texto: "Ótimo desempenho." };

    expect((await req(admin, "PATCH", `/alunos/${a.id}/boletim`, payload)).statusCode).toBe(200);
    // Salvar de novo substitui (não duplica).
    await req(admin, "PATCH", `/alunos/${a.id}/boletim`, { ...payload, texto: "Revisado." });

    const boletim = await req(professor, "GET", `/alunos/${a.id}/boletim`);
    expect(boletim.json().observacoes).toEqual([{ anoLetivo: 2026, periodo: "1", texto: "Revisado." }]);
  });

  it("professor não edita observações; período inválido dá 400", async () => {
    const a = await aluno();
    expect((await req(professor, "PATCH", `/alunos/${a.id}/boletim`, { anoLetivo: 2026, periodo: "1", texto: "x" })).statusCode).toBe(403);
    expect((await req(admin, "PATCH", `/alunos/${a.id}/boletim`, { anoLetivo: 2026, periodo: "3", texto: "x" })).statusCode).toBe(400);
  });

  it("aluno aceita e devolve foto", async () => {
    const a = await aluno();
    const editado = await req(admin, "PATCH", `/alunos/${a.id}`, { foto: PNG });
    expect(editado.statusCode).toBe(200);
    expect((await req(admin, "GET", `/alunos/${a.id}`)).json().foto).toBe(PNG);
  });
});

describe("Nível de ensino padronizado", () => {
  it("aceita as opções da tela e recusa outros valores", async () => {
    const base = { nome: "T", anoLetivo: 2026, valorMensalidade: 500 };
    expect((await req(admin, "POST", "/turmas", { ...base, nivelEnsino: "Fundamental II" })).statusCode).toBe(201);
    expect((await req(admin, "POST", "/turmas", { ...base, nivelEnsino: "Ensino Fundamental II" })).statusCode).toBe(400);
  });
});
