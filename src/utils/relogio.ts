/**
 * Relógio da escola (fuso America/Sao_Paulo).
 *
 * Datas de cobrança (vencimento, validade de desconto) são datas de calendário, gravadas como
 * meia-noite UTC daquele dia — o mesmo que `new Date("2026-03-05")` produz. Por isso a
 * comparação é sempre feita por string "AAAA-MM-DD".
 *
 * Os testes podem fixar o "agora" com `fixarAgora()`, para que regras com datas sejam determinísticas.
 */

const FUSO = "America/Sao_Paulo";

let agoraFixo: Date | null = null;

/** Só para testes: fixa o instante atual (null volta ao relógio real). */
export function fixarAgora(data: Date | null) {
  agoraFixo = data;
}

export function agora() {
  return agoraFixo ?? new Date();
}

/** Data de hoje em São Paulo, "AAAA-MM-DD". */
export function hojeSP(instante = agora()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO }).format(instante);
}

/** Hora atual em São Paulo (0–23). */
export function horaSP(instante = agora()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" }).format(instante));
}

/** "AAAA-MM-DD" → Date à meia-noite UTC (formato usado no banco para datas de calendário). */
export function dataCalendario(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Date → "AAAA-MM-DD" (lido em UTC, como as datas de calendário são gravadas). */
export function ymd(data: Date) {
  return data.toISOString().slice(0, 10);
}

/** Último dia do mês (1–12) do ano. */
export function ultimoDiaDoMes(ano: number, mes: number) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Soma dias a uma data "AAAA-MM-DD". */
export function somarDias(ymdBase: string, dias: number) {
  const d = dataCalendario(ymdBase);
  d.setUTCDate(d.getUTCDate() + dias);
  return ymd(d);
}

const dois = (n: number) => String(n).padStart(2, "0");

/** Monta "AAAA-MM-DD" limitando o dia ao último dia do mês (31 em abril → 30). */
export function dataNoMes(ano: number, mes: number, dia: number) {
  return `${ano}-${dois(mes)}-${dois(Math.min(dia, ultimoDiaDoMes(ano, mes)))}`;
}
