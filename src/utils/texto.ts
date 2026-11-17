/**
 * Chave de comparação para nomes: sem acentos, minúsculas, espaços colapsados.
 * "  Matemática  " e "MATEMATICA" viram "matematica".
 * Precisa bater com a normalização SQL da migration 20261117140000_disciplina_nome_unico.
 */
export function normalizarNome(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
