import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const NOME_BANCO_TESTE = "escola_db_test";

function montarUrlDoBancoDeTeste(urlOriginal: string) {
  const [semQuery, query] = urlOriginal.split("?");
  const partes = semQuery.split("/");
  partes[partes.length - 1] = NOME_BANCO_TESTE;
  const base = partes.join("/");
  return query ? `${base}?${query}` : base;
}

export default async function setup() {
  const urlDev = process.env.DATABASE_URL;
  if (!urlDev) throw new Error("DATABASE_URL não está definida — rode os testes com o mesmo ambiente do backend (ex.: dentro do container).");

  const urlTeste = montarUrlDoBancoDeTeste(urlDev);

  const prismaAdmin = new PrismaClient({ datasources: { db: { url: urlDev } } });
  try {
    await prismaAdmin.$executeRawUnsafe(`CREATE DATABASE ${NOME_BANCO_TESTE}`);
  } catch (erro: any) {
    const jaExiste = erro?.meta?.code === "42P04" || String(erro?.message ?? "").includes("already exists");
    if (!jaExiste) throw erro;
  } finally {
    await prismaAdmin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: urlTeste },
    stdio: "inherit",
  });

  process.env.DATABASE_URL = urlTeste;
}
