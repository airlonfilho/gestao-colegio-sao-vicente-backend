/**
 * LGPD — exposição mínima de dados dos responsáveis.
 *
 * Admin vê o cadastro completo. Professor vê só id e nome: CPF, telefone,
 * e-mail e endereço não são necessários para o trabalho dele.
 */
type Perfil = "admin" | "professor";

/** Para usar em `include: { responsavel: incluirResponsavel(perfil) }`. */
export function incluirResponsavel(perfil: Perfil) {
  return perfil === "admin" ? true : { select: { id: true, nome: true } };
}

/** Campos de um responsável (consulta direta em /responsaveis) conforme o perfil. */
export function camposResponsavel(perfil: Perfil) {
  const alunos = { select: { id: true, nome: true } };
  return perfil === "admin"
    ? { id: true, nome: true, cpf: true, telefone: true, email: true, endereco: true, alunos }
    : { id: true, nome: true, alunos };
}
