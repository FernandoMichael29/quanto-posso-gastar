// Planilha de mentira só para rodar lancar_ fora do Apps Script.
function Aba(cabecalho) {
  this.dados = [cabecalho.slice()];
}
Aba.prototype.getLastRow = function () { return this.dados.length; };
Aba.prototype.appendRow = function (linha) {
  this.dados.push(linha.slice());
};
Aba.prototype.getRange = function (l, c, nl, nc) {
  var aba = this;
  nl = nl || 1; nc = nc || 1;
  return {
    getValues: function () {
      var saida = [];
      for (var i = 0; i < nl; i++) {
        var linha = aba.dados[l - 1 + i] || [];
        saida.push(linha.slice(c - 1, c - 1 + nc));
      }
      return saida;
    },
    setValues: function (v) {
      for (var i = 0; i < v.length; i++) {
        while (aba.dados.length < l - 1 + i + 1) aba.dados.push([]);
        var linha = aba.dados[l - 1 + i];
        for (var j = 0; j < v[i].length; j++) linha[c - 1 + j] = v[i][j];
      }
    },
    setValue: function (x) { aba.getRange(l, c, 1, 1).setValues([[x]]); },
    setNumberFormat: function () { return this; },
    setFontWeight: function () { return this; },
    setBackground: function () { return this; },
    setFontColor: function () { return this; },
    clearContent: function () { return this; }
  };
};
module.exports = { Aba: Aba };
