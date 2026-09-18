/**
 * A máscara de "esperando a planilha", por cima de uma linha só.
 *
 * A janela de edição fecha na hora, mas o valor novo só aparece depois que o
 * script responde. Sem marca nenhuma, esses segundos parecem falha: o item
 * continua com o número antigo e a pessoa tenta editar de novo.
 */
export default function Capa({ quando }) {
  if (!quando) return null;
  return (
    <span className="capa" role="status" aria-label="salvando">
      <span className="girando" aria-hidden="true" />
    </span>
  );
}
