(function(){
'use strict';
var C=window.AppCore;
var $=function(id){return document.getElementById(id);};
var STORE='dup-ledger-v1';
var state={result:null,variant:null,baseline:null,error:''};

function esc(s){return String(s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function p1(r){return C.round1(r*100).toFixed(1);}
function p1v(v){return C.round1(v).toFixed(1);}   // 已是 0–100 的值
function optsFromDom(){
  return {keepCase:$('keepCase').checked,stripComments:$('stripComments').checked,
    foldWhitespace:$('foldWhitespace').checked,flatten:$('flatten').checked};
}
function inputFromDom(){return {docs:$('docs').value,k:$('k').value,tau:$('tau').value,opts:optsFromDom()};}
function setMessage(t,bad){$('message').innerHTML=bad?('<span class="bad">'+esc(t)+'</span>'):esc(t);}
function reasonText(r){return r==='both'?'净雷同与包含度都达标':(r==='net'?'净雷同达标':'包含度达标');}
function nameOf(i){return state.result?state.result.docs[i].name:('#'+i);}

function recompute(keepBaseline){
  try{
    var inp=inputFromDom();
    var r=C.solve(inp);
    state.tokens=C.parseDocs(inp.docs).map(function(d){return C.tokenize(d.text,inp.opts);});
    state.result=r;state.error='';
    if(!keepBaseline)state.baseline=null;
    if(state.baseline!==null&&(state.baseline<0||state.baseline>=r.N))state.baseline=null;
    try{
      var alt=Object.assign({},inputFromDom());
      alt.opts=Object.assign({},alt.opts,{flatten:!alt.opts.flatten});
      state.variant=C.solve(alt);
    }catch(e){state.variant=null;}
    $('error').textContent='';
    render(r);
    setMessage('已按当前条件重算：'+r.N+' 份稿件、'+r.pairs.length+' 对、片段长度 k='+r.k+'、阈值 '+r.tau+'%。');
  }catch(e){
    state.error=e.message;state.result=null;state.variant=null;
    $('error').textContent=e.message;
    $('result').innerHTML='<p class="hint">修好上面的输入后会自动重算。</p>';
    setMessage('输入有问题，未计算：'+e.message,true);
  }
}

// ── 渲染 ────────────────────────────────────────────────────
function render(r){
  var h=[];
  var main=r.stats.groupCount>0
    ? '<div class="metric">'+r.N+' 份稿件里找到 <strong>'+r.stats.groupCount+' 组</strong>可疑雷同，最大一组 <strong>'+r.stats.largest+' 份</strong></div>'
    : '<div class="metric">'+r.N+' 份稿件里<strong>没有</strong>达到 '+r.tau+'% 阈值的雷同对</div>';
  var top=r.pairs[0];
  if(top){
    main+='<p class="hint">最像的一对：<strong>'+esc(r.docs[top.a].name)+'</strong> × <strong>'+esc(r.docs[top.b].name)+'</strong>，净雷同度 <strong>'+p1(top.jaccardW)+'%</strong>'+
      '（表面重合 '+p1(top.jaccardRaw)+'%、双向包含度 '+p1(top.containmentMax)+'%）。</p>';
  }
  h.push(main);
  h.push('<div class="stats">'+
    stat(r.stats.linkCount,'对达到阈值（需人工复核）')+
    stat(r.stats.groupCount,'组可疑雷同')+
    stat(r.stats.involved,'份稿件被连边')+
    stat(r.stats.independent,'份独立')+
    stat(r.gramStats.boiler,'个全组样板片段')+
    stat(r.stats.misleadingCount,'对只像在样板上')+
    '</div>');

  // 结论卡
  if(r.groups.length){
    h.push('<h3>可疑组（含传递）</h3>');
    r.groups.forEach(function(g,gi){
      var mem=g.members.map(function(i){return esc(r.docs[i].name);}).join(' / ');
      h.push('<div class="card"><p><strong>组 '+(gi+1)+'：'+mem+'</strong>'+
        '<span class="tag bad">'+g.size+' 份</span>'+
        (g.bridged?'<span class="tag">含传递</span>':'')+'</p>'+
        '<p class="num">组内 '+g.edgeCount+' 对里 '+g.linkCount+' 对达阈值；净雷同度最高 '+p1(g.maxW)+'%、最低 '+p1(g.minW)+'%、平均 '+p1(g.avgW)+'%。'+
        (g.bridged?'最低那一对自身没达标，是靠着与组内第三人相连才同组——这类组要逐个看证据，不能直接当成一伙。':'')+'</p>'+
        '<p class="num">组内各对：'+g.edges.map(function(e){
          return esc(r.docs[e.a].name)+'–'+esc(r.docs[e.b].name)+' '+p1(e.jaccardW)+'%'+(e.linked?'（连边·'+reasonText(e.reason)+'）':'（未达标）');
        }).join('；')+'</p></div>');
    });
  }
  if(r.stats.misleadingCount){
    h.push('<div class="notice"><strong>'+r.stats.misleadingCount+' 对「表面像、净雷同不像」</strong>（表面重合度过阈值，但净雷同度与双向包含度都没过）：'+
      r.misleading.slice(0,6).map(function(p){return esc(r.docs[p.a].name)+'–'+esc(r.docs[p.b].name)+'（表面 '+p1(p.jaccardRaw)+'% → 净 '+p1(p.jaccardW)+'%）';}).join('；')+
      (r.misleading.length>6?' 等':'')+'。<br>这些对共有的片段基本是全组公共样板，按本工具口径不计入雷同；若你确实想连边，请降低阈值。</div>');
  }
  var hint=variantHint(r);
  if(hint)h.push(hint);

  // 矩阵热图
  h.push('<h3>两两净雷同度矩阵</h3><div class="matrix-wrap"><table class="matrix"><tr><th></th>'+
    r.docs.map(function(d){return '<th>'+esc(d.name)+'</th>';}).join('')+'</tr>'+
    r.docs.map(function(d,i){
      return '<tr><th>'+esc(d.name)+'</th>'+r.docs.map(function(e,j){
        if(i===j)return '<td class="diag">—</td>';
        var v=r.matrix[i][j],over=v>=r.tau/100;
        return '<td class="'+(over?'over':'')+'" style="background:'+cellColor(v)+'">'+C.round1(v*100).toFixed(0)+'</td>';
      }).join('')+'</tr>';
    }).join('')+'</table></div><p class="legend">格子里的数字是净雷同度（%，四舍五入到整数）；红框表示达到阈值 '+r.tau+'%。对角线不参与比较。</p>');

  // 逐对表
  var boilerCol=r.gramStats.boilerApplied?'其中样板':'其中双方共有';
  var rows=r.pairs.slice(0,r.tablePairs);
  h.push('<h3>逐对明细'+(r.pairs.length>rows.length?'（按净雷同度降序，显示前 '+rows.length+' 对，共 '+r.pairs.length+' 对）':'（共 '+rows.length+' 对）')+'</h3>'+
    '<div class="scroll"><table class="stack"><thead><tr><th>稿件 A</th><th>稿件 B</th><th>净雷同度</th><th>表面重合度</th><th>双向包含度</th><th>A→B 包含</th><th>B→A 包含</th><th>共有/并集片段</th><th>其中样板</th><th>判定</th></tr></thead><tbody>'+
    rows.map(function(p){
      var over=p.containmentMax>=r.tau/100||p.jaccardW>=r.tau/100;
      return '<tr><td data-label="稿件 A">'+esc(r.docs[p.a].name)+'</td><td data-label="稿件 B">'+esc(r.docs[p.b].name)+
      '</td><td data-label="净雷同度"><strong>'+p1(p.jaccardW)+'%</strong></td>'+
      '<td data-label="表面重合度">'+p1(p.jaccardRaw)+'%</td>'+
      '<td data-label="双向包含度">'+p1(p.containmentMax)+'%</td>'+
      '<td data-label="A→B 包含">'+p1(p.cAB)+'%</td>'+
      '<td data-label="B→A 包含">'+p1(p.cBA)+'%</td>'+
      '<td data-label="共有/并集片段">'+p.shared+' / '+p.union+'</td>'+
      '<td data-label="'+boilerCol+'">'+p.sharedBoiler+'</td>'+
      '<td data-label="判定">'+(over?'<span class="tag bad">达标</span>':'未达阈值')+'</td></tr>';
    }).join('')+'</tbody></table></div>');

  // 证据段
  if(r.evidence.length&&r.evidence.some(function(e){return e.blockCount>0;})){
    h.push('<h3>最长公共段证据</h3>');
    r.evidence.forEach(function(e){
      if(e.blockCount===0)return;
      h.push('<div class="card"><p><strong>'+esc(r.docs[e.a].name)+' × '+esc(r.docs[e.b].name)+'</strong>：净雷同 '+p1(e.jaccardW)+'%，共 '+e.blockCount+' 段≥'+r.k+' 个 token 的公共连续段，最长 '+e.maxBlock+' 个 token。'+
        (e.truncatedA||e.truncatedB?'<span class="tag">仅比前 2000 个 token</span>':'')+'</p>');
      var first=e.blocks[0];
      if(first){
        h.push(context('A · '+r.docs[e.a].name,e.a,first));
        h.push(context('B · '+r.docs[e.b].name,e.b,first));
      }
      h.push('<div class="scroll"><table class="stack"><thead><tr><th>#</th><th>长度(token)</th><th>A 起始</th><th>B 起始</th><th>片段预览</th></tr></thead><tbody>'+
        e.blocks.map(function(b,bi){return '<tr><td data-label="#">'+(bi+1)+'</td><td data-label="长度(token)">'+b.len+'</td><td data-label="A 起始">'+b.i+'</td><td data-label="B 起始">'+b.j+'</td><td data-label="片段预览"><code>'+esc(b.text)+'</code></td></tr>';}).join('')+
        '</tbody></table></div></div>');
    });
  }

  // 基准
  if(state.baseline!==null&&r.N>1){
    var base=state.baseline;
    var list=r.pairs.filter(function(p){return p.a===base||p.b===base;}).map(function(p){
      var other=p.a===base?p.b:p.a;
      return {other:other,net:p.jaccardW,raw:p.jaccardRaw,con:p.a===base?p.cAB:p.cBA,shared:p.shared};
    }).sort(function(x,y){return y.net-x.net||x.other-y.other;});
    h.push('<h3>与基准「'+esc(r.docs[base].name)+'」的对比 <button id="clearbase" class="mini">清除基准</button></h3>'+
      '<div class="scroll"><table class="stack"><thead><tr><th>稿件</th><th>与基准净雷同度</th><th>表面重合度</th><th>被基准包含</th><th>共有片段</th></tr></thead><tbody>'+
      list.map(function(x){return '<tr><td data-label="稿件">'+esc(r.docs[x.other].name)+'</td><td data-label="与基准净雷同度"><strong>'+p1(x.net)+'%</strong></td><td data-label="表面重合度">'+p1(x.raw)+'%</td><td data-label="被基准包含">'+p1(x.con)+'%</td><td data-label="共有片段">'+x.shared+'</td></tr>';}).join('')+
      '</tbody></table></div>'+
      (list.length?'<p class="hint">最像基准的是 <strong>'+esc(r.docs[list[0].other].name)+'</strong>（'+p1(list[0].net)+'%）。</p>':''));
  }

  // 样板与敏感性
  h.push('<h3>全组公共样板</h3>');
  h.push('<p class="hint">出现在<strong>全部 '+r.N+' 份</strong>稿件里的片段共 <strong>'+r.gramStats.boiler+'</strong> 个，平均占每份稿件片段数的 <strong>'+p1(r.gramStats.boilerShareAvg)+'%</strong>。'+
    (r.gramStats.boilerApplied?'这些片段在计算净雷同度时<strong>被摘掉不计</strong>（权重 0），这正是「看起来都很像」与「净雷同」之间的差额来源。':'本轮只有 2 份稿件，没有「全组样板」可言（任何共有片段都只在这两份里），净雷同度等于表面重合度。')+'</p>');
  if(r.gramStats.boiler){
    h.push('<div class="bars">'+r.docs.map(function(d){
      return '<div class="bar-row"><span class="bar-name">'+esc(d.name)+'</span><span class="bar-track"><i style="width:'+Math.max(2,C.round1(d.boilerShare*100))+'%"></i></span><span class="bar-val">'+p1(d.boilerShare)+'%（'+d.boilerGrams+'/'+d.grams+'）</span></div>';
    }).join('')+'</div>');
    h.push('<details><summary>样板片段示例（前 '+r.gramStats.boilerSamples.length+' 个）</summary><ul class="words">'+
      r.gramStats.boilerSamples.map(function(s){return '<li><code>'+esc(s.label)+'</code> <span class="hint">出现于 '+s.df+' 份</span></li>';}).join('')+'</ul></details>');
  }
  h.push('<h3>阈值敏感性</h3><div class="scroll"><table class="stack"><thead><tr><th>阈值</th><th>连边对数</th><th>可疑组数</th><th>涉及稿件</th></tr></thead><tbody>'+
    r.sensitivity.map(function(s){return '<tr'+(s.tau===r.tau?' class="cur"':'')+'><td data-label="阈值">'+s.tau+'%'+(s.tau===r.tau?'（当前）':'')+'</td><td data-label="连边对数">'+s.edges+'</td><td data-label="可疑组数">'+s.groups+'</td><td data-label="涉及稿件">'+s.involved+'</td></tr>';}).join('')+
    '</tbody></table></div><p class="legend">阈值上下 10–20 个点就能改变结论时，别只看单一阈值下的结果。</p>');

  // 各稿件概览
  h.push('<h3>各稿件概览</h3><div class="scroll"><table class="stack"><thead><tr><th>稿件</th><th>字符</th><th>token</th><th>片段</th><th>'+boilerCol+'</th><th>'+(r.gramStats.boilerApplied?'样板占比':'共有占比')+'</th><th>独有片段</th><th>操作</th></tr></thead><tbody>'+
    r.docs.map(function(d){
      return '<tr><td data-label="稿件">'+esc(d.name)+(state.baseline===d.index?' <span class="tag">基准</span>':'')+'</td><td data-label="字符">'+d.chars+'</td><td data-label="token">'+d.tokens+'</td><td data-label="片段">'+d.grams+(d.wholeGram?'（整篇 1 段）':'')+'</td><td data-label="'+boilerCol+'">'+d.boilerGrams+'</td><td data-label="'+(r.gramStats.boilerApplied?'样板占比':'共有占比')+'">'+p1(d.boilerShare)+'%</td><td data-label="独有片段">'+d.exclusive+'</td><td data-label="操作"><button class="mini" data-base="'+d.index+'">设为基准</button></td></tr>';
    }).join('')+'</tbody></table></div>');

  $('result').innerHTML=h.join('');
  Array.prototype.forEach.call(document.querySelectorAll('button[data-base]'),function(b){
    b.addEventListener('click',function(){state.baseline=+b.getAttribute('data-base');render(state.result);});
  });
  var cb=$('clearbase');
  if(cb)cb.addEventListener('click',function(){state.baseline=null;render(state.result);});
  $('downloads').style.display='flex';
  return h.join('');
}

function stat(v,label){return '<div><strong>'+v+'</strong><span>'+label+'</span></div>';}
function cellColor(v){
  var a=Math.min(0.92,Math.max(0,v)) ;
  return 'rgba(45,95,150,'+(a*0.85+0.04).toFixed(3)+')';
}
function context(label,i,block){
  var toks=state.tokens?state.tokens[i]:null;
  if(!toks)return '';
  var before=toks.slice(Math.max(0,block.i-8),block.i).join(' ');
  var body=toks.slice(block.i,block.i+Math.min(block.len,24)).join(' ')+(block.len>24?' …':'');
  var after=toks.slice(block.i+block.len,block.i+block.len+8).join(' ');
  return '<p class="ctx"><span class="who">'+esc(label)+'</span>'+
    (before?'<span class="dim">…'+esc(before)+'</span> ':'')+
    '<mark>'+esc(body)+'</mark>'+(after?' <span class="dim">'+esc(after)+'…</span>':'')+'</p>';
}
function variantHint(r){
  if(!state.variant||!state.variant.docs||state.variant.docs.length!==r.N)return '';
  var key=function(p){return p.a+'-'+p.b;};
  var cur={};r.links.forEach(function(l){cur[key(l)]=1;});
  var alt={};state.variant.links.forEach(function(l){alt[key(l)]=1;});
  var add=state.variant.links.filter(function(l){return !cur[key(l)];});
  var del=r.links.filter(function(l){return !alt[key(l)];});
  if(!add.length&&!del.length)return '';
  var flip=!r.opts.flatten;
  var parts=[];
  if(add.length){
    var best=add.slice().sort(function(x,y){return y.jaccardW-x.jaccardW;})[0];
    parts.push('新增 '+add.length+' 对（最强：'+esc(r.docs[best.a].name)+'–'+esc(r.docs[best.b].name)+' '+p1(best.jaccardW)+'%）');
  }
  if(del.length)parts.push('减少 '+del.length+' 对');
  return '<div class="notice cool"><strong>'+(flip?'打开「抹平标识符」后':'关掉「抹平标识符」后')+'：</strong>连边从 '+r.stats.linkCount+' 对变成 '+state.variant.stats.linkCount+' 对，'+parts.join('、')+'。'+
    '改名的重合要另看一眼 —— 抹平后连边会变多，因为标识符、数字、字符串都被统一了。'+
    '<button id="tryvariant" class="mini">'+(flip?'抹平标识符后复算':'关掉抹平标识符复算')+'</button></div>';
}

// ── 导出 ────────────────────────────────────────────────────
function download(name,text,mime){
  var blob=new Blob([text],{type:mime||'text/plain;charset=utf-8'});
  var url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(url);a.remove();},1500);
}
function csvText(){
  var r=state.result,ev={};
  r.evidence.forEach(function(e){ev[e.a+'-'+e.b]=e.maxBlock;});
  var head=['稿件A','稿件B','净雷同度%','表面重合度%','A到B包含度%','B到A包含度%','双向包含度%','共有片段','并集片段','共有样板片段','最长公共段token','判定'];
  var lines=[head.join(',')];
  r.pairs.forEach(function(p){
    var over=(p.containmentMax>=r.tau/100||p.jaccardW>=r.tau/100)?'达标':'未达阈值';
    var mb=ev[p.a+'-'+p.b];
    lines.push([r.docs[p.a].name,r.docs[p.b].name,p1(p.jaccardW),p1(p.jaccardRaw),p1(p.cAB),p1(p.cBA),p1(p.containmentMax),p.shared,p.union,p.sharedBoiler,(mb===undefined?'':mb),over]
      .map(function(x){x=String(x);return /[",\n]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;}).join(','));
  });
  lines.push('');
  lines.push(['可疑组','成员','组内对数','达阈值对数','最高净雷同度%','最低净雷同度%'].join(','));
  r.groups.forEach(function(g,gi){
    lines.push([('组'+(gi+1)),g.members.map(function(i){return r.docs[i].name;}).join(' / '),g.edgeCount,g.linkCount,p1(g.maxW),p1(g.minW)].join(','));
  });
  lines.push('');
  lines.push('说明：最长公共段只对证据对计算；净雷同度=摘掉全组公共样板后的重合度；全部数字由同一次计算导出。');
  return lines.join('\n');
}
function mdText(){
  var r=state.result,h=[];
  h.push('# 雷同度对账台 · 本轮结果（'+r.N+' 份稿件）');
  h.push('');
  h.push('- 片段长度 k：'+r.k+'；连边阈值：'+r.tau+'%；全组公共样板片段：'+r.gramStats.boiler+' 个（平均占每份 '+p1(r.gramStats.boilerShareAvg)+'%）');
  h.push('- 达阈值对数：'+r.stats.linkCount+'；可疑组：'+r.stats.groupCount+' 组（最大 '+r.stats.largest+' 份）；独立稿件：'+r.stats.independent+' 份');
  h.push('- 只像在样板上的对：'+r.stats.misleadingCount+' 对');
  if(r.groups.length){
    h.push('');h.push('## 可疑组');
    r.groups.forEach(function(g,gi){
      h.push('- 组 '+(gi+1)+'：'+g.members.map(function(i){return r.docs[i].name;}).join(' / ')+'（组内 '+g.edgeCount+' 对，'+g.linkCount+' 对达标，最高 '+p1(g.maxW)+'%、最低 '+p1(g.minW)+'%）');
    });
  }
  h.push('');h.push('## 逐对明细（前 '+Math.min(r.tablePairs,r.pairs.length)+' 对）');
  h.push('| 稿件A | 稿件B | 净雷同度 | 表面重合度 | 双向包含度 | 共有/并集 | 判定 |');
  h.push('|---|---|---|---|---|---|---|');
  r.pairs.slice(0,r.tablePairs).forEach(function(p){
    var over=(p.containmentMax>=r.tau/100||p.jaccardW>=r.tau/100)?'达标':'未达阈值';
    h.push('| '+r.docs[p.a].name+' | '+r.docs[p.b].name+' | '+p1(p.jaccardW)+'% | '+p1(p.jaccardRaw)+'% | '+p1(p.containmentMax)+'% | '+p.shared+' / '+p.union+' | '+over+' |');
  });
  var ev=r.evidence.filter(function(e){return e.blockCount>0;});
  if(ev.length){
    h.push('');h.push('## 最长公共段');
    ev.forEach(function(e){h.push('- '+r.docs[e.a].name+' × '+r.docs[e.b].name+'：'+e.blockCount+' 段，最长 '+e.maxBlock+' 个 token');});
  }
  h.push('');h.push('## 阈值敏感性');
  r.sensitivity.forEach(function(s){h.push('- 阈值 '+s.tau+'%：连边 '+s.edges+' 对、可疑组 '+s.groups+' 组、涉及 '+s.involved+' 份'+(s.tau===r.tau?'（当前）':''));});
  h.push('');h.push('## 口径与边界');
  h.push('- 片段 = 连续 k 个 token；样板 = 出现在全部 N 份中的片段（N≥3 时权重记 0，即摘掉不计）。');
  h.push('- 净雷同度 = 摘掉样板后的加权 Jaccard；表面重合度 = 不摘样板的 Jaccard；包含度 = 一份稿件的片段有多少比例能在另一份里找到（双向取大）。');
  h.push('- 连边条件：双向包含度 ≥ 阈值（净雷同度 ≥ 阈值必然也满足包含度 ≥ 阈值）。');
  h.push('- 只做文本字面重合，不做语义、逻辑、思路层面的抄袭判定；不联网比对；不下结论、不给处分建议。');
  h.push('');h.push('（本文件由雷同度对账台导出，数字与页面、CSV 同源。）');
  return h.join('\n');
}
function pngCard(){
  var r=state.result,W=1080,H=1350,cv=document.createElement('canvas');
  cv.width=W;cv.height=H;var x=cv.getContext('2d');
  x.fillStyle='#f4f7fb';x.fillRect(0,0,W,H);
  x.fillStyle='#2d5f96';x.fillRect(0,0,W,16);
  x.fillStyle='#22344e';x.font='700 62px "PingFang SC","Hiragino Sans GB",sans-serif';
  x.fillText('雷同度对账台',72,140);
  x.fillStyle='#5a6d84';x.font='400 34px "PingFang SC",sans-serif';
  x.fillText(r.N+' 份稿件的两两重合对账 · k='+r.k+' · 阈值 '+r.tau+'%',72,196);
  x.fillStyle='#22344e';x.font='700 118px "PingFang SC",sans-serif';
  x.fillText(r.stats.groupCount+' 组',72,350);
  x.font='400 40px "PingFang SC",sans-serif';x.fillStyle='#5a6d84';
  x.fillText('可疑雷同（最大 '+r.stats.largest+' 份）',72,412);
  var top=r.pairs[0];
  if(top){
    x.fillStyle='#a23b28';x.font='700 96px "PingFang SC",sans-serif';
    x.fillText(p1(top.jaccardW)+'%',600,350);
    x.fillStyle='#5a6d84';x.font='400 34px "PingFang SC",sans-serif';
    x.fillText('最高一对：'+r.docs[top.a].name+' × '+r.docs[top.b].name,600,404);
  }
  x.strokeStyle='#d9e3ee';x.lineWidth=2;x.beginPath();x.moveTo(72,470);x.lineTo(W-72,470);x.stroke();
  // 自动缩字号的单行绘制，避免超出 1080 画布
  function fit(text,y,size,color,weight,maxW){
    var f=weight+' '+size+'px "PingFang SC","Hiragino Sans GB",sans-serif';
    x.font=f;
    while(x.measureText(text).width>(maxW||W-144)&&size>15){size-=2;x.font=weight+' '+size+'px "PingFang SC","Hiragino Sans GB",sans-serif';}
    x.fillStyle=color;x.fillText(text,72,y);
  }
  fit('达阈值 '+r.stats.linkCount+' 对 · 涉及 '+r.stats.involved+' 份 · 独立 '+r.stats.independent+' 份 · 只像在样板上的对 '+r.stats.misleadingCount+' 对',544,38,'#22344e','700');
  fit('全组公共样板片段 '+r.gramStats.boiler+' 个，平均占每份 '+p1(r.gramStats.boilerShareAvg)+'%（计算净雷同度时摘掉不计）',596,30,'#5a6d84','400');
  var y=680;
  x.fillStyle='#22344e';x.font='700 44px "PingFang SC",sans-serif';
  x.fillText('可疑组',72,y);y+=60;
  x.font='400 34px "PingFang SC",sans-serif';
  if(r.groups.length){
    r.groups.slice(0,4).forEach(function(g){
      x.fillStyle='#22344e';
      x.fillText('组：'+g.members.map(function(i){return r.docs[i].name;}).join(' / '),72,y);y+=48;
      x.fillStyle='#5a6d84';
      x.fillText('　'+g.edgeCount+' 对里 '+g.linkCount+' 对达标，最高 '+p1(g.maxW)+'%、最低 '+p1(g.minW)+'%',72,y);y+=52;
    });
  }else{
    x.fillStyle='#2b6b4f';x.fillText('没有达到阈值的雷同对',72,y);y+=52;
  }
  y+=20;
  x.fillStyle='#22344e';x.font='700 44px "PingFang SC",sans-serif';
  x.fillText('最像的 5 对',72,y);y+=60;
  x.font='400 32px "PingFang SC",sans-serif';
  r.pairs.slice(0,5).forEach(function(p){
    x.fillStyle='#22344e';
    x.fillText(r.docs[p.a].name+' × '+r.docs[p.b].name,72,y);
    x.fillStyle='#2d5f96';
    x.font='400 30px "PingFang SC",sans-serif';
    x.fillText('净 '+p1(p.jaccardW)+'%　表面 '+p1(p.jaccardRaw)+'%　包含 '+p1(p.containmentMax)+'%',500,y);
    x.font='400 32px "PingFang SC",sans-serif';
    y+=46;
  });
  y=Math.max(y+30,H-140);
  fit('默认示例为虚构数据；全部数字来自同一次计算；只做文本字面重合对账，不判定抄袭。',y,26,'#718095','400');
  fit('雷同度对账台 · V1.0.0 · AI 辅助开发',y+42,26,'#718095','400');
  cv.toBlob(function(b){download('雷同度对账台-结果卡.png',b,'image/png');},'image/png');
}

// ── 持久化 ──────────────────────────────────────────────────
function saveLocal(){
  var data={docs:$('docs').value,k:$('k').value,tau:$('tau').value,opts:optsFromDom(),ts:new Date().toISOString()};
  try{localStorage.setItem(STORE,JSON.stringify(data));setMessage('已保存到本机浏览器（'+data.ts+'）。刷新或重开后点「恢复已保存」即可回到这份输入。');}
  catch(e){setMessage('保存失败：'+e.message,true);}
}
function loadLocal(silent){
  var raw=null;
  try{raw=localStorage.getItem(STORE);}catch(e){}
  if(!raw){if(!silent)setMessage('本机没有已保存的输入。',true);return false;}
  try{
    var d=JSON.parse(raw);
    $('docs').value=d.docs||'';$('k').value=d.k||'5';$('tau').value=d.tau||'60';
    var o=d.opts||{};
    $('keepCase').checked=o.keepCase!==undefined?!!o.keepCase:true;
    $('stripComments').checked=o.stripComments!==undefined?!!o.stripComments:true;
    $('foldWhitespace').checked=o.foldWhitespace!==undefined?!!o.foldWhitespace:true;
    $('flatten').checked=!!o.flatten;
    recompute();
    if(!silent)setMessage('已恢复本机保存的输入（'+(d.ts||'时间未知')+'）。');
    return true;
  }catch(e){if(!silent)setMessage('恢复失败：'+e.message,true);return false;}
}

// ── 初始化 ──────────────────────────────────────────────────
function init(){
  $('demo').addEventListener('click',function(){
    $('docs').value=C.sample.docs;$('k').value=C.sample.k;$('tau').value=C.sample.tau;
    $('keepCase').checked=!C.sample.opts.keepCase?false:true;
    $('stripComments').checked=C.sample.opts.stripComments;
    $('foldWhitespace').checked=C.sample.opts.foldWhitespace;
    $('flatten').checked=C.sample.opts.flatten;
    state.baseline=null;recompute();setMessage('已载入 8 份虚构示例作业（非真实考生数据）。');
  });
  $('tight').addEventListener('click',function(){$('tau').value='45';recompute(true);});
  $('loose').addEventListener('click',function(){$('tau').value='75';recompute(true);});
  ['docs','k','tau'].forEach(function(id){$(id).addEventListener('input',function(){recompute(true);});});
  ['keepCase','stripComments','foldWhitespace','flatten'].forEach(function(id){$(id).addEventListener('change',function(){recompute(true);});});
  $('save').addEventListener('click',saveLocal);
  $('restore').addEventListener('click',function(){loadLocal(false);});
  $('backup').addEventListener('click',function(){
    download('雷同度对账台-输入备份.json',JSON.stringify({app:'dup-ledger',version:'1.0.0',saved_at:new Date().toISOString(),
      docs:$('docs').value,k:$('k').value,tau:$('tau').value,opts:optsFromDom()},null,2),'application/json');
  });
  $('import').addEventListener('click',function(){$('imports').click();});
  $('imports').addEventListener('change',function(ev){
    var f=ev.target.files&&ev.target.files[0];if(!f)return;
    var fr=new FileReader();
    fr.onload=function(){
      try{
        var d=JSON.parse(String(fr.result));
        if(!d||typeof d.docs!=='string')throw new Error('文件里没有 docs 字段');
        $('docs').value=d.docs;$('k').value=d.k||'5';$('tau').value=d.tau||'60';
        var o=d.opts||{};
        $('keepCase').checked=o.keepCase!==undefined?!!o.keepCase:true;
        $('stripComments').checked=o.stripComments!==undefined?!!o.stripComments:true;
        $('foldWhitespace').checked=o.foldWhitespace!==undefined?!!o.foldWhitespace:true;
        $('flatten').checked=!!o.flatten;
        recompute();setMessage('已导入备份并重算。');
      }catch(e){setMessage('导入失败：'+e.message,true);}
      ev.target.value='';
    };
    fr.readAsText(f);
  });
  $('csv').addEventListener('click',function(){if(!state.result)return;download('雷同度对账台-逐对明细.csv','\ufeff'+csvText(),'text/csv;charset=utf-8');});
  $('md').addEventListener('click',function(){if(!state.result)return;download('雷同度对账台-结果说明.md',mdText(),'text/markdown;charset=utf-8');});
  $('png').addEventListener('click',function(){if(!state.result)return;pngCard();});
  document.addEventListener('click',function(ev){
    if(ev.target&&ev.target.id==='tryvariant'){
      var box=$('flatten');box.checked=!box.checked;recompute(true);
      setMessage('已切换「抹平标识符」并重算。');
    }
  });
  // 默认：优先恢复本机保存，否则载入虚构示例
  if(!loadLocal(true)){
    $('docs').value=C.sample.docs;$('k').value=C.sample.k;$('tau').value=C.sample.tau;
    $('stripComments').checked=true;$('foldWhitespace').checked=true;$('keepCase').checked=false;$('flatten').checked=false;
    recompute();
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
