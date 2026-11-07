const node = (title, detail, x, y) => ({ title, detail, x, y });
export const flows = {
  overview: { title: 'Do evento à investigação', nodes: [
    node('Aplicação','Produz eventos com horário e contexto.',30,45),
    node('Alloy','Coleta os arquivos e atribui labels de origem.',255,45),
    node('Loki','Armazena e consulta logs organizados em streams.',480,45),
    node('Grafana','Permite explorar os resultados e correlacionar sinais.',705,45)
  ], edges:[[0,1],[1,2],[2,3]] },
  model: { title:'Três formas de representar um atributo', nodes:[
    node('Entrada','Uma mensagem com timestamp e contexto.',30,125),
    node('Labels','Identificam o stream e compõem seu índice.',300,30),
    node('Metadados','Contexto associado sem compor o índice de labels.',300,125),
    node('Linha','Conteúdo preservado para filtros e parsing.',300,220),
    node('Consulta','O custo depende de quais dados precisam ser examinados.',665,125)
  ],edges:[[0,1],[0,2],[0,3],[1,4],[2,4],[3,4]] },
  collect: { title:'Pipeline de coleta com Alloy', nodes:[
    node('Arquivo','O gerador grava JSON e logfmt em arquivos separados.',30,45),
    node('source.file','Lê linhas e mantém posições em volume persistente.',255,45),
    node('process','Extrai request_id do JSON e o anexa como metadado.',480,45),
    node('write','Envia lotes ao endpoint HTTP do Loki.',705,45)
  ],edges:[[0,1],[1,2],[2,3]] },
  write: { title:'Caminho de escrita • fluxo lógico', steps:[0,1,3,1,2,4,2,5], nodes:[
    node('Alloy','Envia linhas, timestamps e labels.',30,40),
    node('Distributor','Valida a requisição e seleciona ingesters responsáveis.',255,40),
    node('Ingester','Mantém chunks em memória; cópias dependem da replicação.',480,40),
    node('Ring','Mapa de participantes consultado para distribuir os streams. Não guarda o log.',255,190),
    node('WAL','Registro em disco local para recuperação. Não é um bucket nem backup.',480,190),
    node('Storage','Recebe chunks e índices no processo de persistência.',705,40)
  ],edges:[[0,1],[1,3],[3,1],[1,2],[2,4],[4,2],[2,5]], labels:{'1-3':'consulta mapa','3-1':'destinos','2-4':'registro local','4-2':'confirmação','2-5':'flush'} },
  read: { title:'Caminho de leitura • fluxo lógico', steps:[0,1,2,3,2,4,2,5,2,0], nodes:[
    node('Frontend','Recebe a consulta, planeja partes elegíveis e reúne respostas.',25,30),
    node('Scheduler','Componente opcional: mantém filas para trabalhadores.',250,30),
    node('Querier','Executa subconsultas e combina dados recentes e históricos.',475,30),
    node('Ingester','Fornece dados recentes que podem ainda não estar no bucket.',700,30),
    node('Index gateway','Atende consultas ao índice para localizar chunks.',475,200),
    node('Storage / cache','Fornece chunks candidatos; cache pode evitar leituras repetidas.',700,200)
  ],edges:[[0,1],[1,2],[2,3],[3,2],[2,4],[4,2],[2,5],[5,2],[2,0]], labels:{'1-2':'trabalho','2-3':'recentes','2-4':'índice','2-5':'busca chunks','5-2':'chunks'} },
  query: { title:'O trabalho de uma consulta', nodes:[
    node('Seletor','Restringe os streams com labels indexados.',30,45),
    node('Filtro literal','Examina a linha e descarta entradas não correspondentes.',255,45),
    node('Parser','Interpreta JSON ou logfmt e extrai campos.',480,45),
    node('Agregação','Conta eventos ou calcula medidas sobre valores.',705,45)
  ],edges:[[0,1],[1,2],[2,3]] },
  storage: { title:'Persistência e ciclo de vida', nodes:[
    node('Ingester','Produz chunks e dados de índice.',30,45),
    node('Storage','Mantém objetos persistidos.',255,45),
    node('Compactor','Compacta índices e aplica retenção quando habilitada.',480,45),
    node('Exclusão','Chunks marcados são removidos depois, de forma assíncrona.',705,45)
  ],edges:[[0,1],[1,2],[2,3]] },
  deploy: { title:'Do laboratório à decisão de produção', nodes:[
    node('Requisitos','Volume, consultas, retenção, isolamento e recuperação.',30,45),
    node('Topologia','Monolítico ou processos separados conforme os requisitos.',255,45),
    node('Garantias','Defina cópias, volumes, acesso e distribuição entre falhas.',480,45),
    node('Validação','Teste ingestão, consultas e recuperação em condições reais.',705,45)
  ],edges:[[0,1],[1,2],[2,3]] }
};
export function edgePath(a,b) {
  const w=180,h=68;
  if (a.y === b.y) return a.x < b.x ? 'M'+(a.x+w)+' '+(a.y+h/2)+' L'+b.x+' '+(b.y+h/2) : 'M'+(a.x+w/2)+' '+a.y+' V'+(a.y-22)+' H'+(b.x+w/2)+' V'+b.y;
  if (a.x === b.x) return a.y < b.y ? 'M'+(a.x+w/2-15)+' '+(a.y+h)+' L'+(b.x+w/2-15)+' '+b.y : 'M'+(a.x+w/2+15)+' '+a.y+' L'+(b.x+w/2+15)+' '+(b.y+h);
  const offset=a.y < b.y ? -15 : 15;
  const sx=a.x+w/2+offset,sy=a.y < b.y ? a.y+h : a.y,tx=b.x+w/2+offset,ty=a.y < b.y ? b.y : b.y+h;
  return 'M'+sx+' '+sy+' V'+((sy+ty)/2+(a.y < b.y ? -12 : 12))+' H'+tx+' V'+ty;
}
