import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";
import { limparBanco } from "./helpers/db.js";
import { criarUsuario, logar, criarTurma, criarResponsavel, criarAluno } from "./helpers/fixtures.js";

const prisma = new PrismaClient();
const app = buildApp();

let admin: string;
let professor: string;

/** Evolution API falsa: responde por rota e guarda as chamadas. */
type Rota = (url: string, init: RequestInit) => { status?: number; corpo?: unknown };
let rotas: Record<string, Rota>;
const chamadas: { url: string; metodo: string; corpo?: unknown; apikey?: string }[] = [];
const fetchOriginal = globalThis.fetch;

beforeEach(async () => {
  await limparBanco(prisma);
  await criarUsuario(prisma, { email: "admin@teste.com", perfil: "admin" });
  await criarUsuario(prisma, { email: "prof@teste.com", perfil: "professor" });
  admin = await logar(app, "admin@teste.com");
  professor = await logar(app, "prof@teste.com");

  process.env.EVOLUTION_API_URL = "http://evolution.teste";
  process.env.EVOLUTION_API_KEY = "chave-teste";
  process.env.EVOLUTION_INSTANCE = "escola";
  chamadas.length = 0;
  rotas = {};
  // Só as chamadas à Evolution são falsas; o resto (inject do Fastify) não usa fetch.
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const caminho = url.replace("http://evolution.teste", "");
    chamadas.push({ url: caminho, metodo: init.method ?? "GET", corpo: init.body ? JSON.parse(String(init.body)) : undefined, apikey: (init.headers as Record<string, string>)?.apikey });
    const chave = Object.keys(rotas).find((r) => caminho.startsWith(r));
    if (!chave) return new Response(JSON.stringify({ message: "rota não simulada" }), { status: 500 });
    const { status = 200, corpo = {} } = rotas[chave](caminho, init);
    return new Response(JSON.stringify(corpo), { status });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = fetchOriginal;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const req = (token: string, method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });

describe("Conexão do WhatsApp (Evolution API)", () => {
  it("só admin acessa", async () => {
    for (const [metodo, url] of [["GET", "/whatsapp/status"], ["POST", "/whatsapp/conectar"], ["POST", "/whatsapp/desconectar"]] as const) {
      expect((await req(professor, metodo, url)).statusCode, url).toBe(403);
    }
  });

  it("sem configuração, o status avisa em vez de dar erro", async () => {
    delete process.env.EVOLUTION_API_URL;
    expect((await req(admin, "GET", "/whatsapp/status")).json()).toEqual({ configurado: false, estado: "desconectado" });
    expect(chamadas).toHaveLength(0);
  });

  it("status conectado traz número e nome; envia a apikey", async () => {
    rotas["/instance/connectionState/escola"] = () => ({ corpo: { instance: { instanceName: "escola", state: "open" } } });
    rotas["/instance/fetchInstances"] = () => ({ corpo: [{ ownerJid: "5588999990000@s.whatsapp.net", profileName: "Colégio", profilePicUrl: "http://foto" }] });
    expect((await req(admin, "GET", "/whatsapp/status")).json()).toEqual({ configurado: true, estado: "conectado", numero: "5588999990000", nome: "Colégio", foto: "http://foto" });
    expect(chamadas[0].apikey).toBe("chave-teste");
  });

  it("Evolution fora do ar → estado indisponível com explicação", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    const corpo = (await req(admin, "GET", "/whatsapp/status")).json();
    expect(corpo.estado).toBe("indisponivel");
    expect(corpo.erro).toMatch(/fora do ar/);
  });

  it("conectar cria a instância na primeira vez e devolve o QR Code", async () => {
    rotas["/instance/connectionState/escola"] = () => ({ status: 404, corpo: { response: { message: ["não existe"] } } });
    rotas["/instance/create"] = () => ({ status: 201, corpo: {} });
    rotas["/instance/connect/escola"] = () => ({ corpo: { base64: "data:image/png;base64,QR", pairingCode: null, code: "2@abc" } });
    const r = await req(admin, "POST", "/whatsapp/conectar", {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ estado: "conectando", qrcode: "data:image/png;base64,QR" });
    expect(chamadas.find((c) => c.url === "/instance/create")?.corpo).toMatchObject({ instanceName: "escola", integration: "WHATSAPP-BAILEYS" });
  });

  it("conectar com número pede código de pareamento com DDI", async () => {
    rotas["/instance/connectionState/escola"] = () => ({ corpo: { instance: { state: "close" } } });
    rotas["/instance/connect/escola"] = () => ({ corpo: { pairingCode: "ABCD1234", base64: "QR" } });
    const r = await req(admin, "POST", "/whatsapp/conectar", { numero: "(88) 99999-0000" });
    expect(r.json()).toMatchObject({ estado: "conectando", codigoPareamento: "ABCD1234", qrcode: "data:image/png;base64,QR" });
    expect(chamadas.at(-1)?.url).toBe("/instance/connect/escola?number=5588999990000");
    expect(chamadas.some((c) => c.url === "/instance/create")).toBe(false);
    expect((await req(admin, "POST", "/whatsapp/conectar", { numero: "123" })).statusCode).toBe(400);
  });

  it("desconectar faz logout (já desconectado não é erro)", async () => {
    rotas["/instance/logout/escola"] = () => ({ status: 400, corpo: { response: { message: ["not connected"] } } });
    expect((await req(admin, "POST", "/whatsapp/desconectar")).statusCode).toBe(204);
    expect(chamadas[0]).toMatchObject({ url: "/instance/logout/escola", metodo: "DELETE" });
  });

  it("mensagem ao responsável: enviada pela Evolution; desconectado → ERRO com motivo", async () => {
    const turma = await criarTurma(prisma);
    const resp = await criarResponsavel(prisma, "wpp");
    const aluno = await criarAluno(prisma, { turmaId: turma.id, responsavelId: resp.id });
    const payload = { alunoId: aluno.id, tipo: "aviso_geral", mensagem: "Reunião amanhã." };

    rotas["/message/sendText/escola"] = () => ({ status: 201, corpo: { key: { id: "1" } } });
    const ok = await req(admin, "POST", "/mensagens-whatsapp/enviar", payload);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe("ENVIADO");
    expect(chamadas.at(-1)?.corpo).toEqual({ number: "5511999998888", text: "Reunião amanhã." });

    rotas["/message/sendText/escola"] = () => ({ status: 400, corpo: { response: { message: ["Connection Closed"] } } });
    rotas["/instance/connectionState/escola"] = () => ({ corpo: { instance: { state: "close" } } });
    const falhou = await req(admin, "POST", "/mensagens-whatsapp/enviar", payload);
    expect(falhou.statusCode).toBe(502);
    expect(falhou.json()).toMatchObject({ status: "ERRO", message: expect.stringMatching(/desconectado/) });
  });
});
