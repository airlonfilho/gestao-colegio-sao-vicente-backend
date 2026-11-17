import { beforeEach, afterEach, afterAll, describe, it, expect } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { executarGeracaoAutomatica } from "../src/services/agendador.js";
import { fixarAgora } from "../src/utils/relogio.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarResponsavel } from "./helpers/fixtures.js";

/**
 * Critérios de aceite da cobrança automática. Valores de exemplo: turma de R$ 1.850,00,
 * dia padrão 10, meses 2 a 12, matrícula de R$ 500,00. O relógio é fixado em 2027.
 */

const prisma = new PrismaClient();
const app = buildApp();

let admin: string;
let professor: string;
let turmaId: number;
let responsavelId: number;

const n = (v: unknown) => Number(v);
const dia = (v: unknown) => String(v).slice(0, 10);

function req(token: string, method: "GET" | "POST" | "PATCH", url: string, payload?: object) {
  return app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

/** Aluno matriculado em 2026 (antes de qualquer mês gerado nos testes). */
async function aluno(dados: Partial<Prisma.AlunoUncheckedCreateInput> = {}) {
  return prisma.aluno.create({
    data: { nome: "Aluno", turmaId, responsavelId, matriculaEm: new Date("2026-01-15"), ...dados },
  });
}

async function configurar(dados: object) {
  const r = await req(admin, "PATCH", "/configuracoes", dados);
  expect(r.statusCode, r.body).toBe(200);
}

async function gerar(mesReferencia: string) {
  return req(admin, "POST", "/mensalidades/gerar", { mesReferencia });
}

const cobrancasDe = (alunoId: number) =>
  prisma.mensalidade.findMany({ where: { alunoId }, orderBy: [{ tipo: "asc" }, { mesReferencia: "asc" }] });

beforeEach(async () => {
  fixarAgora(new Date("2027-03-01T12:00:00Z"));
  await limparBanco(prisma);
  await criarUsuario(prisma, { email: "admin@teste.com", perfil: "admin" });
  await criarUsuario(prisma, { email: "prof@teste.com", perfil: "professor" });
  admin = await logar(app, "admin@teste.com");
  professor = await logar(app, "prof@teste.com");
  turmaId = (await prisma.turma.create({
    data: { nome: "9º Ano A", nivelEnsino: "Fundamental II", anoLetivo: 2027, valorMensalidade: 1850 },
  })).id;
  responsavelId = (await criarResponsavel(prisma, "cobranca")).id;
});

afterEach(() => fixarAgora(null));

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("T1 · configuração", () => {
  it("PATCH salva e GET devolve; dia 32, mês 13 e cobrarMatricula sem valor dão 400; professor recebe 403", async () => {
    await configurar({ diaVencimentoPadrao: 15, mesesCobranca: [3, 2, 3], cobrancaAutomatica: true });
    const cfg = (await req(admin, "GET", "/configuracoes")).json();
    expect(cfg).toMatchObject({ diaVencimentoPadrao: 15, mesesCobranca: [2, 3], cobrancaAutomatica: true });

    expect((await req(admin, "PATCH", "/configuracoes", { diaVencimentoPadrao: 32 })).statusCode).toBe(400);
    expect((await req(admin, "PATCH", "/configuracoes", { mesesCobranca: [2, 13] })).statusCode).toBe(400);
    expect((await req(admin, "PATCH", "/configuracoes", { cobrarMatricula: true })).statusCode).toBe(400);
    expect((await req(professor, "GET", "/configuracoes")).statusCode).toBe(403);
  });
});

describe("T4 · geração mensal", () => {
  it("cria uma mensalidade por aluno ativo, vencendo dia 10; rodar de novo cria 0", async () => {
    const a1 = await aluno();
    await aluno({ nome: "Outro" });
    await aluno({ nome: "Inativo", status: "INATIVO" });

    const r = await gerar("2027-03");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ criadas: 2, jaExistiam: 0, isentas: 0, ignoradas: { alunoInativo: 1 } });

    const [m] = await cobrancasDe(a1.id);
    expect(m).toMatchObject({ tipo: "MENSALIDADE", mesReferencia: "2027-03", status: "PENDENTE" });
    expect(dia(m.vencimento.toISOString())).toBe("2027-03-10");
    expect(n(m.valor)).toBe(1850);

    expect((await gerar("2027-03")).json()).toMatchObject({ criadas: 0, jaExistiam: 2 });
  });

  it("janeiro, fora dos meses 2 a 12, não cria nada e avisa", async () => {
    await aluno();
    const r = await gerar("2027-01");
    expect(r.statusCode).toBe(400);
    expect(r.json().criadas).toBe(0);
    expect(r.json().message).toContain("não está entre os meses");
    expect(await prisma.mensalidade.count()).toBe(0);
  });

  it("aluno com dia 31 vence em 28/02 em fevereiro", async () => {
    const a = await aluno({ diaVencimento: 31 });
    await gerar("2027-02");
    const [m] = await cobrancasDe(a.id);
    expect(dia(m.vencimento.toISOString())).toBe("2027-02-28");
  });

  it("agendador com cobrancaAutomatica desligada não cria nada; ligada, gera o mês corrente", async () => {
    await aluno();
    expect(await executarGeracaoAutomatica(app)).toMatchObject({ executou: false });
    expect(await prisma.mensalidade.count()).toBe(0);

    await configurar({ cobrancaAutomatica: true });
    const r = await executarGeracaoAutomatica(app);
    expect(r).toMatchObject({ executou: true, resultado: { mesReferencia: "2027-03", criadas: 1 } });
  });
});

describe("Descontos", () => {
  it("50% gera R$ 925,00 com valorOriginal 1.850,00 e desconto 925,00", async () => {
    const a = await aluno({ tipoDesconto: "PERCENTUAL", valorDesconto: 50 });
    await gerar("2027-03");
    const [m] = await cobrancasDe(a.id);
    expect([n(m.valorOriginal), n(m.desconto), n(m.valor)]).toEqual([1850, 925, 925]);
  });

  it("desconto fixo de R$ 2.000,00 gera R$ 0,00 ISENTO, nunca negativo", async () => {
    const a = await aluno({ tipoDesconto: "VALOR", valorDesconto: 2000 });
    const r = await gerar("2027-03");
    expect(r.json().isentas).toBe(1);
    const [m] = await cobrancasDe(a.id);
    expect([n(m.desconto), n(m.valor), m.status]).toEqual([1850, 0, "ISENTO"]);
  });

  it("bolsa integral: ISENTO, fora de pendentes/atrasadas, pagamento dá 409", async () => {
    const a = await aluno({ tipoDesconto: "BOLSA_INTEGRAL" });
    await gerar("2027-03");
    fixarAgora(new Date("2027-04-20T12:00:00Z")); // depois do vencimento

    const [m] = await cobrancasDe(a.id);
    expect(m.status).toBe("ISENTO");
    for (const status of ["PENDENTE", "ATRASADO"]) {
      expect((await req(admin, "GET", `/mensalidades?status=${status}`)).json()).toHaveLength(0);
    }
    expect((await req(admin, "GET", "/mensalidades?status=ISENTO")).json()).toHaveLength(1);
    expect((await req(admin, "PATCH", `/mensalidades/${m.id}/pagamento`, { formaPagamento: "PIX" })).statusCode).toBe(409);
  });

  it("desconto com validade vencida não é aplicado", async () => {
    const a = await aluno({ tipoDesconto: "PERCENTUAL", valorDesconto: 50, descontoAte: new Date("2027-02-28") });
    await gerar("2027-03");
    const [m] = await cobrancasDe(a.id);
    expect([n(m.desconto), n(m.valor)]).toEqual([0, 1850]);
  });

  it("validação: percentual acima de 100, valor negativo e valor sem tipo dão 400", async () => {
    const base = { nome: "X", turmaId, responsavelId };
    expect((await req(admin, "POST", "/alunos", { ...base, tipoDesconto: "PERCENTUAL", valorDesconto: 120 })).statusCode).toBe(400);
    expect((await req(admin, "POST", "/alunos", { ...base, tipoDesconto: "VALOR", valorDesconto: -1 })).statusCode).toBe(400);
    expect((await req(admin, "POST", "/alunos", { ...base, valorDesconto: 10 })).statusCode).toBe(400);
  });
});

describe("T5 · matrícula no cadastro", () => {
  const matricula = { cobrarMatricula: true, valorMatricula: 500, periodoMatriculaAte: "02-28" };

  it("no período, com cobrarMatricula, cria matrícula de R$ 500,00 vencendo 5 dias depois", async () => {
    fixarAgora(new Date("2027-01-20T12:00:00Z"));
    await configurar(matricula);

    const r = await req(admin, "POST", "/alunos", { nome: "Novo", turmaId, responsavelId });
    expect(r.statusCode).toBe(201);
    expect(r.json().cobrancasCriadas).toEqual([
      expect.objectContaining({ tipo: "MATRICULA", mesReferencia: "2027-01", valor: "500", status: "PENDENTE" }),
    ]);
    const [m] = await cobrancasDe(r.json().id);
    expect(dia(m.vencimento.toISOString())).toBe("2027-01-25");
  });

  it("depois do período, não cria matrícula; cria a mensalidade do mês se o mês tem cobrança", async () => {
    fixarAgora(new Date("2027-04-15T12:00:00Z"));
    await configurar({ ...matricula, cobrancaAutomatica: true });

    const r = await req(admin, "POST", "/alunos", { nome: "Meio do ano", turmaId, responsavelId });
    expect(r.json().cobrancasCriadas).toEqual([
      expect.objectContaining({ tipo: "MENSALIDADE", mesReferencia: "2027-04", valor: "1850" }),
    ]);
  });

  it("bolsista: matrícula cheia com descontoNaMatricula desligado; ISENTO com ele ligado", async () => {
    fixarAgora(new Date("2027-01-20T12:00:00Z"));
    await configurar(matricula);
    const bolsista = { turmaId, responsavelId, tipoDesconto: "BOLSA_INTEGRAL" };

    const cheia = await req(admin, "POST", "/alunos", { ...bolsista, nome: "B1" });
    expect(cheia.json().cobrancasCriadas[0]).toMatchObject({ valor: "500", status: "PENDENTE" });

    await configurar({ descontoNaMatricula: true });
    const isenta = await req(admin, "POST", "/alunos", { ...bolsista, nome: "B2" });
    expect(isenta.json().cobrancasCriadas[0]).toMatchObject({ valor: "0", status: "ISENTO" });
  });

  it("uma matrícula por aluno por ano letivo (cobrança manual repetida dá 409)", async () => {
    const a = await aluno();
    const m = { alunoId: a.id, tipo: "MATRICULA", valor: 500, vencimento: "2027-01-25" };
    expect((await req(admin, "POST", "/mensalidades", { ...m, mesReferencia: "2027-01" })).statusCode).toBe(201);
    expect((await req(admin, "POST", "/mensalidades", { ...m, mesReferencia: "2027-02" })).statusCode).toBe(409);
  });
});

describe("T6 · recálculo ao alterar o aluno", () => {
  it("mudar para turma de R$ 2.000,00 recalcula as não pagas (com desconto); as pagas não mudam", async () => {
    const a = await aluno({ tipoDesconto: "PERCENTUAL", valorDesconto: 10 });
    await gerar("2027-03");
    await gerar("2027-04");
    const [marco] = await cobrancasDe(a.id);
    await req(admin, "PATCH", `/mensalidades/${marco.id}/pagamento`, { formaPagamento: "PIX" });

    const nova = await prisma.turma.create({
      data: { nome: "Médio", nivelEnsino: "Ensino Médio", anoLetivo: 2027, valorMensalidade: 2000 },
    });
    const r = await req(admin, "PATCH", `/alunos/${a.id}`, { turmaId: nova.id });
    expect(r.json().cobrancasRecalculadas).toBe(1);

    const [m3, m4] = await cobrancasDe(a.id);
    expect([m3.status, n(m3.valor)]).toEqual(["PAGO", 1665]);
    expect([n(m4.valorOriginal), n(m4.desconto), n(m4.valor)]).toEqual([2000, 200, 1800]);
  });

  it("diaVencimento: sem aplicarPendentes não altera; com aplicarPendentes altera só as não pagas", async () => {
    const a = await aluno();
    await gerar("2027-03");
    await gerar("2027-04");
    const [marco] = await cobrancasDe(a.id);
    await req(admin, "PATCH", `/mensalidades/${marco.id}/pagamento`, { formaPagamento: "PIX" });

    await req(admin, "PATCH", `/alunos/${a.id}`, { diaVencimento: 20 });
    let [m3, m4] = await cobrancasDe(a.id);
    expect(dia(m4.vencimento.toISOString())).toBe("2027-04-10");

    await req(admin, "PATCH", `/alunos/${a.id}`, { diaVencimento: 25, aplicarPendentes: true });
    [m3, m4] = await cobrancasDe(a.id);
    expect(dia(m3.vencimento.toISOString())).toBe("2027-03-10"); // paga: não muda
    expect(dia(m4.vencimento.toISOString())).toBe("2027-04-25");
  });

  it("desconto novo com aplicarPendentes recalcula as não pagas", async () => {
    const a = await aluno();
    await gerar("2027-04");
    await req(admin, "PATCH", `/alunos/${a.id}`, { tipoDesconto: "BOLSA_INTEGRAL", aplicarPendentes: true });
    const [m] = await cobrancasDe(a.id);
    expect([n(m.valor), m.status]).toEqual([0, "ISENTO"]);
  });
});

describe("T7 · editar cobrança", () => {
  it("cobrança paga dá 409; pendente recalcula valor e situação; desconto maior que o valor dá 400", async () => {
    const a = await aluno();
    await gerar("2027-03");
    await gerar("2027-04");
    const [marco, abril] = await cobrancasDe(a.id);
    await req(admin, "PATCH", `/mensalidades/${marco.id}/pagamento`, { formaPagamento: "PIX" });

    expect((await req(admin, "PATCH", `/mensalidades/${marco.id}`, { desconto: 10 })).statusCode).toBe(409);
    expect((await req(admin, "PATCH", `/mensalidades/${abril.id}`, { desconto: 5000 })).statusCode).toBe(400);

    const parcial = await req(admin, "PATCH", `/mensalidades/${abril.id}`, { valorOriginal: 1000, desconto: 250 });
    expect(parcial.json()).toMatchObject({ valor: "750", status: "PENDENTE" });

    const isenta = await req(admin, "PATCH", `/mensalidades/${abril.id}`, { desconto: 1000 });
    expect(isenta.json()).toMatchObject({ valor: "0", status: "ISENTO" });
  });
});

describe("T8 · filtros e privacidade", () => {
  it("filtra por tipo; cada item traz tipo, valorOriginal e desconto", async () => {
    const a = await aluno();
    await gerar("2027-03");
    await req(admin, "POST", "/mensalidades", { alunoId: a.id, tipo: "MATRICULA", mesReferencia: "2027-01", valor: 500, vencimento: "2027-01-25" });

    const mats = (await req(admin, "GET", "/mensalidades?tipo=MATRICULA")).json();
    expect(mats).toHaveLength(1);
    expect(mats[0]).toMatchObject({ tipo: "MATRICULA", valorOriginal: "500", desconto: "0" });
    expect((await req(admin, "GET", "/mensalidades?tipo=MENSALIDADE")).json()).toHaveLength(1);
  });

  it("professor não recebe os campos de desconto do aluno; admin recebe", async () => {
    const a = await aluno({ tipoDesconto: "PERCENTUAL", valorDesconto: 30, motivoDesconto: "Irmãos", diaVencimento: 5 });

    for (const url of ["/alunos", `/alunos/${a.id}`, `/turmas/${turmaId}/alunos`]) {
      const corpo = (await req(professor, "GET", url)).json();
      const item = Array.isArray(corpo) ? corpo[0] : corpo;
      expect(item, url).not.toHaveProperty("tipoDesconto");
      expect(item, url).not.toHaveProperty("valorDesconto");
      expect(item, url).not.toHaveProperty("motivoDesconto");
      expect(item.diaVencimento, url).toBe(5);
    }
    const doAdmin = (await req(admin, "GET", `/alunos/${a.id}`)).json();
    expect(doAdmin).toMatchObject({ tipoDesconto: "PERCENTUAL", valorDesconto: "30", motivoDesconto: "Irmãos" });
  });
});
