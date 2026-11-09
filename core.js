(function(g){
'use strict';
// 雷同度对账台 · 核心计算（纯函数，无 DOM、无网络）
// 口径与公式见 需求与调研.md「需求简报」一节

var OPT_DEFAULTS={keepCase:false,stripComments:true,foldWhitespace:true,flatten:false};
var KEYWORDS=new Set(['if','else','for','while','do','return','break','continue','switch','case','default',
'int','long','short','float','double','char','bool','void','unsigned','signed','const','static','struct',
'class','public','private','protected','new','delete','using','namespace','std','include','define','sizeof',
'typedef','enum','union','template','try','catch','throw','this','null','true','false','nil','def','import',
'from','as','in','not','and','or','is','none','elif','except','finally','raise','lambda','yield','with',
'pass','global','print','printf','cout','cin','endl','let','var','function','begin','end','await','async']);

var MAX_DOCS=20, MIN_DOCS=2, MAX_CHARS=12000, MAX_TOKENS=3000, MAX_K=12, MIN_K=2;
var BLOCK_TOKEN_CAP=2000, EVIDENCE_PAIRS=12, EVIDENCE_BLOCKS=6, TABLE_PAIRS=24, BOILER_SAMPLES=5;

function toInt(v,label){
  if(typeof v==='number'){if(!Number.isInteger(v))throw new Error(label+' 需为整数');return v;}
  if(typeof v==='string'&&v.trim()!==''){var n=Number(v);if(!Number.isFinite(n)||!Number.isInteger(n))throw new Error(label+' 需为整数');return n;}
  throw new Error(label+'不能为空');
}

// ── 文本归一化 ───────────────────────────────────────────────
// 朴素文本处理：不理解字符串字面量；代码里字符串内含 // 、/* 或行首 # 会被一并去掉。
function stripComments(s){
  var out='',i=0,n=s.length;
  while(i<n){
    var c=s[i];
    if(c==='/'&&s[i+1]==='*'){var e1=s.indexOf('*/',i+2);i=e1<0?n:e1+2;out+=' ';continue;}
    if(c==='/'&&s[i+1]==='/'){var e2=s.indexOf('\n',i);i=e2<0?n:e2;out+=' ';continue;}
    if(c==='#'){
      var k=out.length-1,atLineStart=true;
      while(k>=0&&out[k]!=='\n'){if(!/\s/.test(out[k])){atLineStart=false;break;}k--;}
      if(atLineStart){var e3=s.indexOf('\n',i);i=e3<0?n:e3;out+=' ';continue;}
    }
    out+=c;i++;
  }
  return out;
}

function normalizeText(text,o){
  var s=String(text).replace(/\r\n?/g,'\n');
  if(o.stripComments)s=stripComments(s);
  if(o.foldWhitespace)s=s.replace(/\s+/g,' ');
  if(!o.keepCase)s=s.toLowerCase();
  return s;
}

var TOKEN_RE=/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\\s]|\\.)*'|[^\sA-Za-z0-9_]/g;

function tokenize(text,o){
  var s=normalizeText(text,o);
  var raw=s.match(TOKEN_RE)||[];
  if(!o.flatten)return raw;
  return raw.map(function(t){
    var c=t[0];
    if(c==='"'||c==="'")return c==='"'?'"S"':"'C'";
    if(/[0-9]/.test(c))return '0';
    if(/[A-Za-z_]/.test(c))return KEYWORDS.has(t)?t:'x';
    return t;
  });
}

// ── 稿件解析 ────────────────────────────────────────────────
function parseDocs(raw){
  if(typeof raw!=='string')throw new Error('稿件格式不正确：需要一个文本框内容');
  var lines=raw.replace(/\r\n?/g,'\n').split('\n');
  var blocks=[],cur=[];
  for(var i=0;i<lines.length;i++){
    if(lines[i].trim()==='---'){blocks.push(cur);cur=[];}else cur.push(lines[i]);
  }
  blocks.push(cur);
  var out=[];
  for(var b=0;b<blocks.length;b++){
    var blk=blocks[b].slice(),name='';
    while(blk.length&&blk[0].trim()==='')blk.shift();   // 允许块首空行后再写 @名称
    if(blk.length&&/^\s*@/.test(blk[0])){name=blk[0].replace(/^\s*@\s*/,'').trim();blk.shift();}
    var text=blk.join('\n').trim();   // 稿件文本两端空白不计
    if(text==='')continue;
    out.push({name:name,text:text});
  }
  out.forEach(function(d,idx){if(!d.name)d.name='稿件'+(idx+1);});
  // 重名自动加序号
  var seen={};
  out.forEach(function(d){
    if(seen[d.name]===undefined){seen[d.name]=1;}
    else{seen[d.name]++;d.name=d.name+'（'+seen[d.name]+'）';}
  });
  return out;
}

// ── 片段 ────────────────────────────────────────────────────
var SEP='\u0001';

function gramsOf(tokens,k){
  var list=[],set=new Set();
  if(tokens.length===0)return {list:list,set:set,whole:false};
  if(tokens.length<k){
    var key=tokens.join(SEP);
    list.push(key);set.add(key);
    return {list:list,set:set,whole:true};
  }
  for(var i=0;i+k<=tokens.length;i++){
    var g=tokens.slice(i,i+k).join(SEP);
    if(!set.has(g)){set.add(g);list.push(g);}
  }
  return {list:list,set:set,whole:false};
}

function gramLabel(gram){
  return gram.split(SEP).join(' · ');
}

// ── 极大公共连续段（精确，穷举全部极大段）─────────────────────
function commonBlocksAll(a,b,minLen){
  var n=a.length,m=b.length,out=[];
  if(!n||!m||minLen<1)return out;
  var W=m+1,L=new Uint16Array((n+1)*W),i,j;
  for(i=1;i<=n;i++){
    for(j=1;j<=m;j++){ if(a[i-1]===b[j-1])L[i*W+j]=L[(i-1)*W+(j-1)]+1; }
  }
  for(i=1;i<=n;i++){
    for(j=1;j<=m;j++){
      var len=L[i*W+j];
      if(len<minLen)continue;
      if(i<n&&j<m&&L[(i+1)*W+(j+1)]===len+1)continue; // 还能沿对角线延长 → 不是极大段
      out.push({len:len,i:i-len,j:j-len});
    }
  }
  // 去掉被更长的块在两侧区间上完全包住的块（其内容必然是被包块的超串，显示冗余）
  out=out.filter(function(c){
    return !out.some(function(d){
      return d!==c&&d.i<=c.i&&d.j<=c.j&&d.i+d.len>=c.i+c.len&&d.j+d.len>=c.j+c.len;
    });
  });
  out.sort(function(x,y){return y.len-x.len||x.i-y.i||x.j-y.j;});
  return out;
}

function round1(x){return Math.round(x*10)/10;}   // 已按 0–100 计的值，保留 1 位小数
function pct(r){return round1(r*100);}            // 比值 0–1 → 百分数 0–100（1 位小数）
function linkReason(p,t){
  var byNet=p.jaccardW>=t,byCon=p.containmentMax>=t;
  // 定理：双向包含度 ≥ 净雷同度（同一次共享权重除以更小的分母）
  return byNet&&byCon?'both':(byNet?'net':'contain');
}

// ── 主计算 ─────────────────────────────────────────────────
function solve(input){
  if(!input||typeof input!=='object')throw new Error('输入格式不正确');
  var docs=parseDocs(input.docs);
  if(docs.length<MIN_DOCS)throw new Error('至少需要 2 份稿件才能对账');
  if(docs.length>MAX_DOCS)throw new Error('最多 20 份稿件');
  var k=toInt(input.k,'片段长度 k');
  if(k<MIN_K||k>MAX_K)throw new Error('片段长度 k 需为 '+MIN_K+'–'+MAX_K+' 的整数');
  var tau=toInt(input.tau,'阈值');
  if(tau<0||tau>100)throw new Error('阈值需为 0–100 的整数');
  var o={keepCase:!!OPT_DEFAULTS.keepCase,stripComments:!!OPT_DEFAULTS.stripComments,
         foldWhitespace:!!OPT_DEFAULTS.foldWhitespace,flatten:!!OPT_DEFAULTS.flatten};
  var io=input.opts||{};
  ['keepCase','stripComments','foldWhitespace','flatten'].forEach(function(key){
    if(io[key]!==undefined)o[key]=!!io[key];
  });

  var N=docs.length,chars=[];
  docs.forEach(function(d){
    chars.push([...d.text].length);
    if([...d.text].length>MAX_CHARS)throw new Error('「'+d.name+'」超过 '+MAX_CHARS+' 字符');
  });

  var toks=[],grs=[];
  docs.forEach(function(d,idx){
    var tk=tokenize(d.text,o);
    if(tk.length===0)throw new Error('「'+d.name+'」去掉注释后没有任何 token，请检查内容或关闭「去注释」');
    if(tk.length>MAX_TOKENS)throw new Error('「'+d.name+'」超过 '+MAX_TOKENS+' 个 token');
    toks.push(tk);grs.push(gramsOf(tk,k));
  });

  // df 与权重：出现在全部 N 份里的片段（df=N）视为「全组公共样板」，权重 0（N≥3 时才谈样板）；
  // 其余片段一律等权 1。因此「净雷同度」= 先摘掉公共样板再算的重合度。
  var df=new Map();
  grs.forEach(function(gg){ gg.set.forEach(function(x){df.set(x,(df.get(x)||0)+1);}); });
  var boilerApplied=N>=3;
  var wOf=new Map();
  df.forEach(function(c,x){wOf.set(x,(boilerApplied&&c===N)?0:1);});
  var allGrams=new Set();grs.forEach(function(gg){gg.set.forEach(function(x){allGrams.add(x);});});
  var boilerGrams=[];df.forEach(function(c,x){if(c===N)boilerGrams.push(x);});
  boilerGrams.sort();

  var docInfo=[],tot=[];
  docs.forEach(function(d,idx){
    var sum=0,bsum=0,bcnt=0;
    grs[idx].set.forEach(function(x){var w=wOf.get(x);sum+=w;if(df.get(x)===N){bsum+=w;bcnt++;}});
    tot.push(sum);
    docInfo.push({index:idx,name:d.name,chars:chars[idx],tokens:toks[idx].length,
      grams:grs[idx].set.size,wholeGram:grs[idx].whole,weightTotal:sum,boilerWeight:bsum,
      boilerGrams:bcnt,boilerShare:grs[idx].set.size>0?bcnt/grs[idx].set.size:0,exclusive:0});
    // 只有本份含有的片段数
    var ex=0;grs[idx].set.forEach(function(x){if(df.get(x)===1)ex++;});
    docInfo[idx].exclusive=ex;
  });

  function metrics(i,j){
    var A=grs[i].set,B=grs[j].set,shared=0,sumShared=0,sharedBoiler=0,sharedGrams=[];
    A.forEach(function(x){ if(B.has(x)){shared++;var w=wOf.get(x);sumShared+=w;if(df.get(x)===N)sharedBoiler++;sharedGrams.push(x);} });
    var unionCount=A.size+B.size-shared,sumUnion=tot[i]+tot[j]-sumShared;
    var inter=tot[i]+tot[j];
    return {a:i,b:j,shared:shared,sharedGrams:sharedGrams,sharedBoiler:sharedBoiler,union:unionCount,
      jaccardW:sumUnion>0?sumShared/sumUnion:0,
      jaccardRaw:unionCount>0?shared/unionCount:0,
      cAB:tot[i]>0?sumShared/tot[i]:0,
      cBA:tot[j]>0?sumShared/tot[j]:0,
      containmentMax:Math.max(tot[i]>0?sumShared/tot[i]:0,tot[j]>0?sumShared/tot[j]:0)};
  }

  var pairs=[],matrix=[];
  for(var a=0;a<N;a++){matrix.push(new Array(N).fill(0));matrix[a][a]=1;}
  for(var i2=0;i2<N;i2++)for(var j2=i2+1;j2<N;j2++){
    var m=metrics(i2,j2);
    pairs.push(m);matrix[i2][j2]=m.jaccardW;matrix[j2][i2]=m.jaccardW;
  }
  pairs.sort(function(x,y){return y.jaccardW-x.jaccardW||y.containmentMax-x.containmentMax||x.a-y.a||x.b-y.b;});

  var t=tau/100;
  // 连边：双向包含度 ≥ τ。净雷同度 ≤ 双向包含度恒成立，故「净雷同度 ≥ τ」是它的子集，
  // 写成 OR 只为口径完整；reason 记录这一对是靠哪一项达标的。
  var links=pairs.filter(function(p){return p.containmentMax>=t||p.jaccardW>=t;});
  // 只像在公共样板上的对：表面重合过阈值，但净雷同与双向包含都没过
  var misleading=pairs.filter(function(p){return p.jaccardRaw>=t&&p.jaccardW<t&&p.containmentMax<t;})
    .sort(function(x,y){return y.jaccardRaw-x.jaccardRaw||x.a-y.a||x.b-y.b;});

  // 并查集
  var par=[];for(var q=0;q<N;q++)par.push(q);
  function find(x){while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;}
  function uni(x,y){x=find(x);y=find(y);if(x!==y)par[y]=x;}
  var linkSet=new Set();
  links.forEach(function(p){uni(p.a,p.b);linkSet.add(p.a+'-'+p.b);});

  var comp=new Map();
  for(var c2=0;c2<N;c2++){var r=find(c2);if(!comp.has(r))comp.set(r,[]);comp.get(r).push(c2);}
  var groups=[],independent=[];
  comp.forEach(function(mem){
    mem.sort(function(x,y){return x-y;});
    if(mem.length<2){independent.push(mem[0]);return;}
    var inG=pairs.filter(function(p){return mem.indexOf(p.a)>=0&&mem.indexOf(p.b)>=0;});
    var maxW=0,minW=1;
    inG.forEach(function(p){if(p.jaccardW>maxW)maxW=p.jaccardW;if(p.jaccardW<minW)minW=p.jaccardW;});
    if(!inG.length){maxW=0;minW=0;}
    var linked=inG.filter(function(p){return p.containmentMax>=t||p.jaccardW>=t;});
    groups.push({members:mem,size:mem.length,
      edges:inG.map(function(p){return {a:p.a,b:p.b,jaccardW:p.jaccardW,containmentMax:p.containmentMax,
        reason:linkReason(p,t),linked:(p.containmentMax>=t||p.jaccardW>=t)};}),
      edgeCount:inG.length,linkCount:linked.length,maxW:maxW,minW:minW,
      avgW:inG.length?inG.reduce(function(s,p){return s+p.jaccardW;},0)/inG.length:0,
      bridged:linked.length<inG.length},
      // bridged=true 表示组内有对未达标，靠第三方传递才会同组
      );
  });
  groups.sort(function(x,y){return y.size-x.size||y.maxW-x.maxW||x.members[0]-y.members[0];});
  independent.sort(function(x,y){return x-y;});

  // 阈值敏感性（τ 与 ±10、±20，越界裁剪去重）
  var taus=[tau-20,tau-10,tau,tau+10,tau+20].map(function(x){return Math.min(100,Math.max(0,x));})
    .filter(function(x,idx,arr){return arr.indexOf(x)===idx;}).sort(function(x,y){return x-y;});
  var sensitivity=taus.map(function(tt){
    var lim=tt/100,es=pairs.filter(function(p){return p.containmentMax>=lim||p.jaccardW>=lim;});
    var p2=[];for(var z=0;z<N;z++)p2.push(z);
    function f2(x){while(p2[x]!==x){p2[x]=p2[p2[x]];x=p2[x];}return x;}
    es.forEach(function(p){var A2=f2(p.a),B2=f2(p.b);if(A2!==B2)p2[B2]=A2;});
    var cnt={};
    es.forEach(function(p){cnt[f2(p.a)]=(cnt[f2(p.a)]||0)+1;});
    var involved=new Set();es.forEach(function(p){involved.add(p.a);involved.add(p.b);});
    var gsz={};var used=new Set();
    es.forEach(function(p){var rt=f2(p.a);if(!used.has(rt)){used.add(rt);var c3=0;for(var z2=0;z2<N;z2++)if(f2(z2)===rt)c3++;gsz[rt]=c3;}});
    var gc=0;Object.keys(gsz).forEach(function(rt){if(gsz[rt]>=2)gc++;});
    return {tau:tt,edges:es.length,groups:gc,involved:involved.size};
  });

  // 证据对：连边对按 score 降序取前 EVIDENCE_PAIRS；无连边时取最像的一对
  var byScore=pairs.slice().sort(function(x,y){
    var sx=Math.max(x.jaccardW,x.containmentMax),sy=Math.max(y.jaccardW,y.containmentMax);
    return sy-sx||x.a-y.a||x.b-y.b;});
  var chosen=links.length?links.slice().sort(function(x,y){
    var sx=Math.max(x.jaccardW,x.containmentMax),sy=Math.max(y.jaccardW,y.containmentMax);
    return sy-sx||x.a-y.a||x.b-y.b;}).slice(0,EVIDENCE_PAIRS)
    :(byScore.length?[byScore[0]]:[]);
  var evidence=chosen.map(function(p){
    var ta=toks[p.a].slice(0,BLOCK_TOKEN_CAP),tb=toks[p.b].slice(0,BLOCK_TOKEN_CAP);
    var all=commonBlocksAll(ta,tb,k);
    var top=all.slice(0,EVIDENCE_BLOCKS).map(function(bl){
      return {len:bl.len,i:bl.i,j:bl.j,text:ta.slice(bl.i,bl.i+Math.min(bl.len,20)).join(' ')+(bl.len>20?' …':'')};
    });
    return {a:p.a,b:p.b,jaccardW:p.jaccardW,containmentMax:p.containmentMax,jaccardRaw:p.jaccardRaw,
      blockCount:all.length,maxBlock:all.length?all[0].len:0,blocks:top,
      truncatedA:toks[p.a].length>BLOCK_TOKEN_CAP,truncatedB:toks[p.b].length>BLOCK_TOKEN_CAP};
  });

  var maxPair=pairs.length?pairs[0]:null;
  var maxRaw=pairs.slice().sort(function(x,y){return y.jaccardRaw-x.jaccardRaw||x.a-y.a||x.b-y.b;})[0]||null;
  var involvedSet=new Set();links.forEach(function(p){involvedSet.add(p.a);involvedSet.add(p.b);});

  return {
    N:N,k:k,tau:tau,opts:o,
    docs:docInfo,
    gramStats:{unique:allGrams.size,totalPerDoc:docInfo.map(function(d){return d.grams;}),
      boiler:boilerGrams.length,boilerApplied:boilerApplied,
      boilerShareAvg:docInfo.reduce(function(s,d){return s+d.boilerShare;},0)/N,
      boilerSamples:boilerGrams.slice(0,BOILER_SAMPLES).map(function(x){return {label:gramLabel(x),df:df.get(x),w:wOf.get(x)};})},
    pairs:pairs.map(function(p){
      return {a:p.a,b:p.b,jaccardW:p.jaccardW,jaccardRaw:p.jaccardRaw,cAB:p.cAB,cBA:p.cBA,
        containmentMax:p.containmentMax,shared:p.shared,union:p.union,sharedBoiler:p.sharedBoiler};
    }),
    matrix:matrix,
    links:links.map(function(p){return {a:p.a,b:p.b,jaccardW:p.jaccardW,containmentMax:p.containmentMax,score:Math.max(p.jaccardW,p.containmentMax),reason:linkReason(p,t)};}),
    misleading:misleading.map(function(p){return {a:p.a,b:p.b,jaccardRaw:p.jaccardRaw,jaccardW:p.jaccardW};}),
    groups:groups,
    independent:independent,
    sensitivity:sensitivity,
    evidence:evidence,
    stats:{linkCount:links.length,groupCount:groups.length,largest:groups.length?groups[0].size:0,
      involved:involvedSet.size,independent:independent.length,
      maxPair:maxPair?{a:maxPair.a,b:maxPair.b,jaccardW:maxPair.jaccardW,containmentMax:maxPair.containmentMax}:null,
      maxRaw:maxRaw?{a:maxRaw.a,b:maxRaw.b,jaccardRaw:maxRaw.jaccardRaw,jaccardW:maxRaw.jaccardW}:null,
      misleadingCount:misleading.length},
    tablePairs:TABLE_PAIRS
  };
}

var sample={
docs:[
'@张一\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  int sum = 0;\n  for (int i = 0; i < n; i++) sum = sum + a[i];\n  double avg = sum * 1.0 / n;\n  cout << "sum=" << sum << endl;\n  cout << "avg=" << avg << endl;\n  return 0;\n}',
'@李二\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  long long total = 0;\n  int mx = a[0];\n  for (int i = 1; i < n; i++) {\n    total += a[i];\n    if (a[i] > mx) mx = a[i];\n  }\n  printf("%lld %d\\n", total, mx);\n  return 0;\n}',
'@王三\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  int sum = 0;\n  for (int i = 0; i < n; i++) sum = sum + a[i];\n  double avg = sum * 1.0 / n;\n  cout << "total=" << sum << endl;\n  cout << "average=" << avg << endl;\n  return 0;\n}',
'@赵四\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  int sum = 0;\n  if (n == 0) return 0;\n  for (int i = 0; i < n; i++) sum = sum + a[i];\n  double avg = sum * 1.0 / n;\n  cout << "sum=" << sum << "\\n";\n  cout << "avg=" << avg << "\\n";\n  return 0;\n}',
'@陈五\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  sort(a, a + n);\n  int mid = a[n / 2];\n  cout << mid << "\\n";\n  return 0;\n}',
'@刘六\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  int best = a[0];\n  for (int i = 1; i < n; i++) if (a[i] > best) best = a[i];\n  cout << best << "\\n";\n  return 0;\n}',
'@孙七\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  long long s = 0;\n  int big = a[0];\n  for (int i = 1; i < n; i++) {\n    s += a[i];\n    if (a[i] > big) big = a[i];\n  }\n  printf("%lld %d\\n", s, big);\n  return 0;\n}',
'@周八\nusing namespace std;\nint main() {\n  int n;\n  cin >> n;\n  int a[1005];\n  for (int i = 0; i < n; i++) cin >> a[i];\n  cout << n << "\\n";\n  return 0;\n}'
].join('\n---\n'),
k:'5',tau:'60',opts:{keepCase:false,stripComments:true,foldWhitespace:true,flatten:false}
};

var api={sample:sample,solve:solve,parseDocs:parseDocs,normalizeText:normalizeText,tokenize:tokenize,
  gramsOf:gramsOf,gramLabel:gramLabel,commonBlocksAll:commonBlocksAll,round1:round1,pct:pct,
  OPT_DEFAULTS:OPT_DEFAULTS,KEYWORDS:KEYWORDS,
  LIMITS:{MAX_DOCS:MAX_DOCS,MIN_DOCS:MIN_DOCS,MAX_CHARS:MAX_CHARS,MAX_TOKENS:MAX_TOKENS,MIN_K:MIN_K,MAX_K:MAX_K,
    BLOCK_TOKEN_CAP:BLOCK_TOKEN_CAP,EVIDENCE_PAIRS:EVIDENCE_PAIRS,EVIDENCE_BLOCKS:EVIDENCE_BLOCKS,TABLE_PAIRS:TABLE_PAIRS}};
g.AppCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
