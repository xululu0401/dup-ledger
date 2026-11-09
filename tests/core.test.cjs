const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');

const OPTS={keepCase:false,stripComments:true,foldWhitespace:true,flatten:false};

// ── 独立朴素参考实现（不复用 core 内部函数，按需求简报公式重写）────────────
function refGrams(tokens,k){
  const s=new Set();
  if(tokens.length<k){s.add(tokens.join('|'));return s;}
  for(let i=0;i+k<=tokens.length;i++)s.add(tokens.slice(i,i+k).join('|'));
  return s;
}
function refSolve(docsArr,k,tau){
  const N=docsArr.length;
  const G=docsArr.map(d=>refGrams(d.split(' '),k));
  const df=new Map();
  G.forEach(s=>s.forEach(g=>df.set(g,(df.get(g)||0)+1)));
  const boilerApplied=N>=3;
  const w=g=>(boilerApplied&&df.get(g)===N)?0:1;      // 全组公共样板（df=N）不计权重
  const tot=G.map(s=>{let x=0;s.forEach(g=>x+=w(g));return x;});
  const pairs=[];
  for(let i=0;i<N;i++)for(let j=i+1;j<N;j++){
    let sumShared=0,shared=0;
    G[i].forEach(g=>{if(G[j].has(g)){shared++;sumShared+=w(g);}});
    const unionCount=G[i].size+G[j].size-shared,sumUnion=tot[i]+tot[j]-sumShared;
    pairs.push({a:i,b:j,
      jaccardW:sumUnion>0?sumShared/sumUnion:0,
      jaccardRaw:unionCount>0?shared/unionCount:0,
      cAB:tot[i]>0?sumShared/tot[i]:0,
      cBA:tot[j]>0?sumShared/tot[j]:0,
      containmentMax:Math.max(tot[i]>0?sumShared/tot[i]:0,tot[j]>0?sumShared/tot[j]:0)});
  }
  const par=[...Array(N).keys()];
  function find(x){while(par[x]!==x){par[x]=par[par[x]];x=par[x];}return x;}
  const t=tau/100;
  pairs.filter(p=>p.jaccardW>=t||p.containmentMax>=t).forEach(p=>{const x=find(p.a),y=find(p.b);if(x!==y)par[y]=x;});
  const byRoot=new Map();
  for(let i=0;i<N;i++){const r=find(i);if(!byRoot.has(r))byRoot.set(r,[]);byRoot.get(r).push(i);}
  const groups=[...byRoot.values()].filter(m=>m.length>1).map(m=>m.sort((x,y)=>x-y));
  groups.sort((x,y)=>y.length-x.length||x[0]-y[0]);
  return {pairs,groups};
}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}

// ── 1. 默认虚构示例锚点 ───────────────────────────────────────
test('默认虚构示例：锚点数字与分组',()=>{
  const r=C.solve(C.sample);
  assert.equal(r.N,8);assert.equal(r.k,5);assert.equal(r.tau,60);
  const g=id=>r.groups.length;
  assert.equal(r.stats.linkCount,2);
  assert.equal(r.stats.groupCount,1);
  assert.equal(r.stats.largest,3);
  assert.deepEqual(r.groups[0].members,[0,2,3]);
  assert.deepEqual(r.groups[0].members.map(i=>r.docs[i].name),['张一','王三','赵四']);
  assert.equal(r.stats.independent,5);
  assert.equal(r.stats.misleadingCount,0);
  const top=r.pairs[0];
  assert.equal(top.a,0);assert.equal(top.b,2);
  assert.equal(C.pct(top.jaccardW),66.7);
  assert.equal(C.pct(top.jaccardRaw),80.6);
  assert.equal(C.pct(top.cAB),80);
  assert.equal(C.pct(top.cBA),80);
  assert.equal(top.shared,83);assert.equal(top.union,103);assert.equal(top.sharedBoiler,43);
  assert.equal(r.gramStats.boiler,43);
  assert.equal(C.pct(r.gramStats.boilerShareAvg),51.4);
  assert.equal(r.gramStats.boilerApplied,true);
  assert.equal(C.pct(r.docs[7].boilerShare),79.6);      // 周八近八成片段是全组样板
  // 改名对（李二/孙七）在默认口径下不连边
  const renamed=r.pairs.find(p=>p.a===1&&p.b===6);
  assert.equal(C.pct(renamed.jaccardW),31.8);
  assert.equal(C.pct(renamed.jaccardRaw),54.7);
  assert.equal(renamed.sharedBoiler,43);               // 共有片段全部是全组样板
  assert.ok(!r.links.some(p=>(p.a===1&&p.b===6)));
  // 证据段：张一/王三 的最长公共段 87 个 token
  const ev=r.evidence.find(e=>e.a===0&&e.b===2);
  assert.equal(ev.maxBlock,87);
  assert.equal(ev.blockCount,3);
  assert.ok(ev.blocks.length<=C.LIMITS.EVIDENCE_BLOCKS);
  // 敏感性：τ=50 出 2 组
  const s50=r.sensitivity.find(s=>s.tau===50);
  assert.equal(s50.edges,4);assert.equal(s50.groups,2);
  assert.equal(r.sensitivity.find(s=>s.tau===40).groups,3);
  assert.equal(r.sensitivity.find(s=>s.tau===60).groups,1);
});

// ── 2. 与独立朴素实现对拍 ────────────────────────────────────
test('加权指标与连通组：300 组随机文档与独立参考实现对拍',()=>{
  const rnd=mulberry32(20261109);
  const alpha=['aa','bb','cc','dd','ee','ff','gg'];
  for(let it=0;it<300;it++){
    const N=3+Math.floor(rnd()*4);
    const k=2+Math.floor(rnd()*3);
    const tau=Math.floor(rnd()*101);
    const pre=alpha.slice(0,1+Math.floor(rnd()*3));
    const docs=[];
    for(let i=0;i<N;i++){
      const body=[];
      const len=4+Math.floor(rnd()*10);
      for(let j=0;j<len;j++)body.push(alpha[Math.floor(rnd()*alpha.length)]);
      docs.push(pre.concat(body).join(' '));
    }
    const got=C.solve({docs:docs.join('\n---\n'),k:String(k),tau:String(tau),opts:OPTS});
    const ref=refSolve(docs,k,tau);
    assert.equal(got.pairs.length,ref.pairs.length,'对数');
    for(const rp of ref.pairs){
      const gp=got.pairs.find(p=>p.a===rp.a&&p.b===rp.b);
      assert.ok(gp,'缺对');
      for(const key of ['jaccardW','jaccardRaw','cAB','cBA','containmentMax'])
        assert.ok(Math.abs(gp[key]-rp[key])<1e-12,`${key} 不一致 it${it} ${rp.a}-${rp.b}`);
    }
    const canon=gs=>gs.map(g=>g.join(',')).sort();
    assert.deepEqual(canon(got.groups.map(g=>g.members)),canon(ref.groups),'连通组');
    got.pairs.forEach(p=>assert.ok(p.containmentMax+1e-12>=p.jaccardW,'包含度应 ≥ 净雷同度'));
    // 连边规则等价于「双向包含度 ≥ τ」
    got.links.forEach(l=>assert.ok(l.containmentMax>=tau/100-1e-12));
  }
});

// ── 3. 最长公共段与暴力参考对拍 ──────────────────────────────
test('最长公共段：200 组随机序列与暴力参考实现对拍',()=>{
  const rnd=mulberry32(777);
  const alpha=['p','q','r','s'];
  for(let it=0;it<200;it++){
    const n=1+Math.floor(rnd()*9),m=1+Math.floor(rnd()*9),minLen=1+Math.floor(rnd()*3);
    const a=[],b=[];
    for(let i=0;i<n;i++)a.push(alpha[Math.floor(rnd()*alpha.length)]);
    for(let j=0;j<m;j++)b.push(alpha[Math.floor(rnd()*alpha.length)]);
    const cand=[];
    for(let i=0;i<n;i++)for(let j=0;j<m;j++){
      let l=0;while(i+l<n&&j+l<m&&a[i+l]===b[j+l])l++;
      if(l>=minLen)cand.push({i,j,len:l});
    }
    const uniq=[...new Map(cand.map(c=>[c.i+','+c.j+','+c.len,c])).values()];
    const keep=uniq.filter(c=>!uniq.some(d=>d!==c&&d.i<=c.i&&d.j<=c.j&&d.i+d.len>=c.i+c.len&&d.j+d.len>=c.j+c.len));
    const norm=x=>x.map(c=>c.i+':'+c.j+':'+c.len).sort();
    assert.deepEqual(norm(C.commonBlocksAll(a,b,minLen)),norm(keep),`it${it} minLen${minLen}`);
  }
});

// ── 4. 阈值两侧 ─────────────────────────────────────────────
test('阈值两侧：τ 跨过包含度阈值时连边与组数翻转',()=>{
  const docs=['aa bb cc dd ee ff gg hh','aa bb cc dd ee ff gg ii','zz yy xx ww vv uu tt ss'].join('\n---\n');
  const mid=C.solve({docs,k:'2',tau:'60',opts:OPTS});
  const p=mid.pairs[0];
  assert.equal(C.pct(p.jaccardW),75);                  // 三份里没有全组样板，净雷同 = 表面重合
  assert.equal(C.pct(p.jaccardRaw),75);
  assert.equal(C.pct(p.containmentMax),85.7);
  assert.equal(mid.stats.linkCount,1);
  assert.equal(mid.links[0].reason,'both');            // 净雷同度正好等于阈值（含等号）
  assert.equal(C.solve({docs,k:'2',tau:'85',opts:OPTS}).stats.linkCount,1);   // 边界含等号（包含度 85.7）
  const hi=C.solve({docs,k:'2',tau:'86',opts:OPTS});   // 阈值升到 86% → 断边
  assert.equal(hi.stats.linkCount,0);
  assert.equal(hi.stats.groupCount,0);
  assert.equal(hi.stats.misleadingCount,0);
  // τ=100：只有完全相同的片段集合才连边
  const eq=C.solve({docs:'aa bb cc dd\n---\naa bb cc dd',k:'2',tau:'100',opts:OPTS});
  assert.equal(eq.stats.linkCount,1);
  assert.equal(C.pct(eq.pairs[0].jaccardW),100);
  // 只像在公共样板上的对：表面重合过阈值，净雷同与包含度都不过 → 记入误报预警，不连边
  const boiler=C.solve({docs:['pp qq rr ss u1 v1','pp qq rr ss u2 v2','pp qq rr ss u3 v3'].join('\n---\n'),k:'2',tau:'40',opts:OPTS});
  assert.equal(C.pct(boiler.pairs[0].jaccardRaw),42.9); // 表面：共有的都是样板（3 个片段 / 并集 7 个）
  assert.equal(C.pct(boiler.pairs[0].jaccardW),0);      // 净雷同：摘掉样板后一无共有
  assert.equal(C.pct(boiler.pairs[0].containmentMax),0);
  assert.equal(boiler.stats.linkCount,0);
  assert.equal(boiler.stats.misleadingCount,3);
  assert.ok(boiler.links.every(x=>x.reason==='contain'||x.reason==='both'));
});

// ── 5. 样板折扣（含 1/df 权重与两份退化）─────────────────────
test('样板折扣：全组共有片段不计权重，三人以上才谈样板',()=>{
  const docs=['pp qq rr ss tt u1 v1','pp qq rr ss tt u2 v2','pp qq rr ss tt u3 v3','pp qq rr ss tt u4 v4'].join('\n---\n');
  const r=C.solve({docs,k:'2',tau:'50',opts:OPTS});
  assert.equal(r.gramStats.boiler,4);                 // pp..tt 共 5 个 token 组成的 4 个片段出现在全部 4 份
  assert.equal(r.gramStats.boilerSamples[0].w,0);     // 全组样板权重 0（摘掉不计）
  assert.equal(r.stats.linkCount,0);
  assert.equal(r.stats.misleadingCount,6);            // 6 对全是「表面像、净雷同不像」
  const p=r.pairs[0];
  assert.equal(C.pct(p.jaccardRaw),50);
  assert.equal(C.pct(p.jaccardW),0);                  // 4 份共有 4 个样板片段，摘掉后两两无共有
  assert.ok(p.jaccardRaw>p.jaccardW);
  assert.equal(C.pct(p.containmentMax),0);
  // 两份时没有「全组样板」可言：净雷同度 = 表面重合度
  const two=C.solve({docs:'aa bb cc dd\n---\naa bb cc ee',k:'2',tau:'60',opts:OPTS});
  assert.equal(two.pairs[0].jaccardW,two.pairs[0].jaccardRaw);
  assert.equal(C.pct(two.pairs[0].jaccardW),50);      // 两份时所有共有片段 df=2=N，权重相同 → 净=表面
  assert.equal(C.pct(two.pairs[0].containmentMax),66.7);
  assert.equal(two.stats.linkCount,1);                // 靠包含度连上
  assert.equal(two.links[0].reason,'contain');
});

// ── 6. 包含度分支与零分母 ───────────────────────────────────
test('包含度分支：短稿被长稿整段包住时 Jaccard 低但包含度 100%',()=>{
  const r=C.solve({docs:'w1 w2 w3 w4 w5 w6 w7 w8\n---\nw3 w4 w5 w6',k:'2',tau:'95',opts:OPTS});
  const p=r.pairs[0];
  assert.equal(C.pct(p.cBA),100);
  assert.equal(C.pct(p.jaccardW),42.9);   // 2 份时不谈「全组样板」，净雷同 = 表面重合
  assert.equal(C.pct(p.jaccardRaw),42.9);
  assert.equal(r.stats.linkCount,1);
  assert.equal(r.links[0].reason,'contain');
  assert.equal(r.groups.length,1);
  assert.deepEqual(r.groups[0].members,[0,1]);
  assert.equal(r.groups[0].bridged,false);
  // 完全互异 → 0，不产生零分母 NaN
  const z=C.solve({docs:'aa bb cc\n---\ndd ee ff',k:'2',tau:'0',opts:OPTS});
  assert.equal(z.pairs[0].jaccardW,0);
  assert.equal(z.pairs[0].jaccardRaw,0);
  assert.equal(z.pairs[0].containmentMax,0);
  assert.ok(Number.isFinite(z.gramStats.boilerShareAvg));
  assert.equal(z.tau,0);
  assert.deepEqual(z.groups.map(g=>g.members),[[0,1]]); // τ=0 时零交集也算连边（口径已写明）
});

// ── 7. 归一化开关 ───────────────────────────────────────────
test('归一化开关：大小写 / 注释 / 空白 / 抹平标识符',()=>{
  const code='int Alpha = 1; // 计数\nint Beta = 2;';
  const same=C.solve({docs:code+'\n---\n'+code.toUpperCase().replace('// 计数','// count'),k:'3',tau:'99',opts:OPTS});
  assert.equal(C.pct(same.pairs[0].jaccardW),100);      // 忽略大小写默认开
  const cs=C.solve({docs:code+'\n---\n'+code.toUpperCase().replace('// 计数','// count'),k:'3',tau:'99',opts:{...OPTS,keepCase:true}});
  assert.ok(C.pct(cs.pairs[0].jaccardW)<100);
  const nc=C.solve({docs:code+'\n---\n'+code.replace('// 计数','// 完全不同的说明文字'),k:'3',tau:'99',opts:{...OPTS,stripComments:false}});
  assert.ok(C.pct(nc.pairs[0].jaccardW)<100);
  const st=C.solve({docs:code+'\n---\n'+code.replace('// 计数','// 完全不同的说明文字'),k:'3',tau:'99',opts:OPTS});
  assert.equal(C.pct(st.pairs[0].jaccardW),100);        // 去注释默认开
  const ws=C.solve({docs:'aa bb   cc\n\n dd\n---\naa bb cc dd',k:'2',tau:'99',opts:OPTS});
  assert.equal(C.pct(ws.pairs[0].jaccardW),100);        // 折叠空白默认开
  // 抹平标识符：只改名的两份
  const rn=['int alpha = 0; return alpha;','int beta = 0; return beta;'].join('\n---\n');
  const off=C.solve({docs:rn,k:'2',tau:'80',opts:OPTS});
  const on=C.solve({docs:rn,k:'2',tau:'80',opts:{...OPTS,flatten:true}});
  assert.equal(C.pct(off.pairs[0].jaccardW),27.3);     // 只改了名的短稿件：默认口径下只有 27.3%
  assert.equal(C.pct(off.pairs[0].containmentMax),42.9);
  assert.equal(off.stats.linkCount,0);
  assert.equal(C.pct(on.pairs[0].jaccardW),100);       // 抹平标识符后完全一致
  assert.equal(on.stats.linkCount,1);
});

// ── 8. 稿件解析：空块 / 名称 / 重名 ─────────────────────────
test('稿件解析：空块忽略、@名称、自动命名与重名加序号',()=>{
  const d=C.parseDocs('\n\n@甲\naa bb\n---\n\n---\n@甲\ncc dd\n---\nee ff\n');
  assert.deepEqual(d.map(x=>x.name),['甲','甲（2）','稿件3']);
  assert.deepEqual(d.map(x=>x.text),['aa bb','cc dd','ee ff']);
  const t=C.tokenize('Cout << "A B" ; don\'t 12.5',OPTS);
  assert.deepEqual(t,['cout','<','<','"a b"',';','don',"'",'t','12.5']);   // 忽略大小写对整段文本生效（含字符串内容）
  assert.deepEqual(C.tokenize('int Alpha=1;',OPTS),['int','alpha','=','1',';']);
  assert.equal(C.tokenize('中文 混排',OPTS).length,4);
});

// ── 9. 单位、舍入与上限 ─────────────────────────────────────
test('单位与舍入：百分比保留 1 位小数，显示值不反算',()=>{
  assert.equal(C.pct(0.5789473684210527),57.9);
  assert.equal(C.pct(0.12344),12.3);
  assert.equal(C.pct(1),100);
  assert.equal(C.pct(0),0);
  assert.equal(C.round1(12.34),12.3);
  assert.equal(C.round1(12.35),12.4);
  const r=C.solve(C.sample);
  r.pairs.forEach(p=>{assert.ok(p.jaccardW>=0&&p.jaccardW<=1);assert.ok(p.jaccardRaw>=0&&p.jaccardRaw<=1);});
  assert.equal(r.matrix.length,8);
  assert.equal(r.matrix[0][0],1);
  assert.equal(r.matrix[0][2],r.matrix[2][0]);
  assert.ok(r.matrix[0][2]<1);
});

// ── 10. 非法输入与上限 ──────────────────────────────────────
test('非法输入与上限：条数、k、τ、长度、空 token',()=>{
  assert.throws(()=>C.solve({docs:'aa bb',k:'2',tau:'50'}),/至少需要 2 份/);
  const many=Array(21).fill('aa bb cc').join('\n---\n');
  assert.throws(()=>C.solve({docs:many,k:'2',tau:'50'}),/最多 20 份/);
  assert.throws(()=>C.solve({docs:'aa bb\n---\ncc dd',k:'1',tau:'50'}),/k 需为 2–12/);
  assert.throws(()=>C.solve({docs:'aa bb\n---\ncc dd',k:'13',tau:'50'}),/k 需为 2–12/);
  assert.throws(()=>C.solve({docs:'aa bb\n---\ncc dd',k:'x',tau:'50'}),/k 需为整数/);
  assert.throws(()=>C.solve({docs:'aa bb\n---\ncc dd',k:2.5,tau:'50'}),/k 需为整数/);
  assert.throws(()=>C.solve({docs:'aa bb\n---\ncc dd',k:'2',tau:'101'}),/0–100/);
  assert.throws(()=>C.solve({docs:'aa bb\n---\ncc dd',k:'2',tau:'-1'}),/0–100/);
  assert.throws(()=>C.solve({docs:'aa bb\n---\ncc dd',k:'2',tau:''}),/不能为空/);
  assert.throws(()=>C.solve({docs:123,k:'2',tau:'50'}),/稿件格式不正确/);
  const big='a '.repeat(13000);
  assert.throws(()=>C.solve({docs:big+'\n---\nbb',k:'2',tau:'50'}),/超过 12000 字符/);
  const toks=Array(3001).fill('q').join(' ');
  assert.throws(()=>C.solve({docs:toks+'\n---\nbb cc',k:'2',tau:'50'}),/超过 3000 个 token/);
  assert.throws(()=>C.solve({docs:'// 只有注释\n---\naa bb',k:'2',tau:'50'}),/没有任何 token/);
  // 少于 k 个 token 的稿件：整篇记 1 个片段
  const tiny=C.solve({docs:'aa\n---\naa',k:'5',tau:'60',opts:OPTS});
  assert.equal(tiny.docs[0].wholeGram,true);
  assert.equal(tiny.docs[0].grams,1);
  assert.equal(C.pct(tiny.pairs[0].jaccardW),100);
  assert.equal(tiny.stats.linkCount,1);
});

// ── 11. 排序确定性与证据块选择规则 ──────────────────────────
test('排序确定性、表格与证据上限、无连边时取最像一对',()=>{
  const a=C.solve(C.sample),b=C.solve(C.sample);
  assert.equal(JSON.stringify(a),JSON.stringify(b));
  assert.equal(a.tablePairs,24);
  for(let i=1;i<a.pairs.length;i++)assert.ok(a.pairs[i-1].jaccardW>=a.pairs[i].jaccardW);
  assert.ok(a.links.length<=C.LIMITS.EVIDENCE_PAIRS);
  assert.ok(a.evidence.length<=C.LIMITS.EVIDENCE_PAIRS&&a.evidence.length>0);
  assert.ok(a.evidence.every(e=>e.blocks.length<=C.LIMITS.EVIDENCE_BLOCKS));
  assert.ok(a.evidence.every(e=>e.maxBlock>=a.k||e.blockCount===0));
  // 无连边时证据仍给出最像的一对
  const none=C.solve({docs:'aa bb cc dd ee\n---\nzz yy xx ww vv',k:'2',tau:'100',opts:OPTS});
  assert.equal(none.stats.linkCount,0);
  assert.equal(none.evidence.length,1);
  assert.equal(none.evidence[0].maxBlock,0);
  assert.equal(none.evidence[0].blocks.length,0);
  // 证据块搜索截断：>2000 token 时标注 truncated
  const long=Array(2100).fill('q').join(' ');
  const tr=C.solve({docs:long+'\n---\n'+long,k:'2',tau:'50',opts:OPTS});
  assert.equal(tr.evidence[0].truncatedA,true);
  assert.equal(tr.evidence[0].truncatedB,true);
});

// ── 12. 分组桥接与链式传递 ──────────────────────────────────
test('分组：链式桥接（两两不达标但都与第三人相连）',()=>{
  const r=C.solve(C.sample);
  const g=r.groups[0];
  assert.equal(g.size,3);
  assert.equal(g.edgeCount,3);                        // 组内两两共 3 对
  assert.equal(g.linkCount,2);                        // 其中 2 对达标
  assert.equal(g.bridged,true);                       // 有 1 对没达标，靠与张一相连才同组
  assert.equal(C.pct(g.maxW),66.7);
  assert.equal(C.pct(g.minW),34.1);
  assert.equal(C.pct(g.avgW),51.2);
  const wangZhao=g.edges.find(e=>(e.a===2&&e.b===3)||(e.a===3&&e.b===2));
  assert.ok(C.pct(wangZhao.jaccardW)<r.tau);          // 王三/赵四自身不达阈值
  assert.equal(wangZhao.linked,false);
  assert.equal(wangZhao.reason,'contain');
  assert.equal(r.stats.involved,3);
  assert.deepEqual(r.independent,[1,4,5,6,7]);
});
