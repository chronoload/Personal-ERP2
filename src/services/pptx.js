// ============================================================
// services/pptx.js
// 纯前端最小 PPTX 生成器（零依赖）：安卓 webview / 浏览器都可用。
//   .pptx 本质是 ZIP 包装的 OOXML 包：这里用 CompressionStream('deflate-raw')
//   手写 ZIP 容器 + CRC32，产出 PowerPoint 可打开的幻灯片。
//   本模块只消费「去身份聚合」数据（计数/比值/时长），不触碰原始流水/余额/身份。
// ============================================================

// ---------- CRC32（zip 校验） ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(u8) {
  let c = -1;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ---------- UTF-8 编码 ----------
function utf8(str) {
  return new TextEncoder().encode(str);
}
// ZIP 文件名用 UTF-8 时置位 general purpose bit 11，PowerPoint 才认中文名
// （这里内部部件名都用 ASCII，实际上不需要；保留函数备用）

// ---------- deflate-raw ----------
async function deflateRaw(u8) {
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- ZIP 容器 ----------
// entries: [{ name, data: Uint8Array }]；全部 DEFLATE（method 8）。
async function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameB = utf8(e.name);
    const crc = crc32(e.data);
    const compressed = await deflateRaw(e.data);
    const localHeader = new DataView(new ArrayBuffer(30));
    // local file header signature
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0x0800, true); // general purpose: bit 11 (utf8)
    localHeader.setUint16(8, 8, true); // method: deflate
    localHeader.setUint16(10, 0, true); // mod time
    localHeader.setUint16(12, 0x21, true); // mod date
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, compressed.length, true);
    localHeader.setUint32(22, e.data.length, true);
    localHeader.setUint16(26, nameB.length, true);
    localHeader.setUint16(28, 0, true); // extra len

    chunks.push(new Uint8Array(localHeader.buffer), nameB, compressed);

    // central directory record
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // central dir signature
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0x0800, true); // flags
    cd.setUint16(10, 8, true); // method
    cd.setUint16(12, 0, true); // mod time
    cd.setUint16(14, 0x21, true); // mod date
    cd.setUint32(16, crc, true);
    cd.setUint32(20, compressed.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint16(30, 0, true); // extra
    cd.setUint16(32, 0, true); // comment
    cd.setUint16(34, 0, true); // disk
    cd.setUint16(36, 0, true); // internal attrs
    cd.setUint32(38, 0, true); // external attrs
    cd.setUint32(42, offset, true); // local header offset
    central.push({ buf: new Uint8Array(cd.buffer), name: nameB });

    offset += 30 + nameB.length + compressed.length;
  }
  for (const c of central) { chunks.push(c.buf, c.name); }

  const cdStart = offset;
  const cdSize = central.reduce((s, c) => s + c.buf.length + c.name.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central dir signature
  end.setUint16(4, 0, true); // disk
  end.setUint16(6, 0, true); // disk with cd
  end.setUint16(8, central.length, true); // entries this disk
  end.setUint16(10, central.length, true); // total entries
  end.setUint32(12, cdSize, true); // cd size
  end.setUint32(16, cdStart, true); // cd offset
  end.setUint16(20, 0, true); // comment len
  chunks.push(new Uint8Array(end.buffer));

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ---------- OOXML 部件 ----------
// 单文本形状（避免中文编码坑，用预设字体）。shapeId 必须唯一（PowerPoint 严格校验重复 cNvPr id）
function textShape(text, id, { y = '1.6cm', size = '1600', bold = false, x = '0.8cm' } = {}) {
  const rPr = bold
    ? `<a:rPr lang="zh-CN" sz="${size}" b="1"><a:solidFill><a:srgbClr val="404040"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr>`
    : `<a:rPr lang="zh-CN" sz="${size}"><a:solidFill><a:srgbClr val="595959"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr>`;
  const escT = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${cm(x)}" y="${cm(y)}"/><a:ext cx="${cm('23cm')}" cy="${cm('1cm')}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r>${rPr}<a:t>${escT}</a:t></a:r></a:p></p:txBody></p:sp>`;
}
function cm(v) {
  // 1 cm = 360000 EMU
  const n = parseFloat(v);
  return String(Math.round(n * 360000));
}

// 单页切片（id 自 2 起递增给行文本，1 留给标题，根组用 0）
function slideXml(title, lines) {
  const shapes = [
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${cm('0.6cm')}" y="${cm('0.5cm')}"/><a:ext cx="${cm('24cm')}" cy="${cm('1.4cm')}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="2800" b="1"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${escXml(title)}</a:t></a:r></a:p></p:txBody></p:sp>`,
  ];
  lines.forEach((ln, i) => shapes.push(textShape(ln, i + 2, { y: `${2.0 + i * 1.1}cm` })));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="0" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// 静态部件（每份 PPTX 相同的样板）
const CONTENT_TYPES = (n) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${Array.from({ length: n }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const CORE_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>智能简报</dc:title><dc:creator>Personal ERP</dc:creator><cp:lastModifiedBy>Personal ERP</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-08-30T00:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-30T00:00:00Z</dcterms:modified>
</cp:coreProperties>`;

const APP_PROPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Personal ERP</Application><AppVersion>1.0</AppVersion><Slides>0</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>
</Properties>`;

const PRESENTATION = (n) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

const PRESENTATION_RELS = (n) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${Array.from({ length: n }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}
</Relationships>`;

// 所有幻灯都引用唯一的 slideLayout1（PowerPoint 严格校验：布局必须存在）
const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="0" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle/><p:extLst/></p:txStyles></p:sldMaster>`;

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="0" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Offce">
<a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="5B9BD5"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="4472C4"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

// ---------- 主入口 ----------
// deck: { label, slides: [{ title, lines: [] }] }
// 返回 Promise<Blob>（application/vnd.openxmlformats-officedocument.presentationml.presentation）
export async function buildPptxBlob(deck) {
  const n = deck.slides.length;
  if (n < 1) throw new Error('至少需要 1 页');
  const entries = [
    { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES(n)) },
    { name: '_rels/.rels', data: utf8(ROOT_RELS) },
    { name: 'docProps/core.xml', data: utf8(CORE_PROPS) },
    { name: 'docProps/app.xml', data: utf8(APP_PROPS) },
    { name: 'ppt/presentation.xml', data: utf8(PRESENTATION(n)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: utf8(PRESENTATION_RELS(n)) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: utf8(SLIDE_MASTER) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: utf8(SLIDE_MASTER_RELS) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: utf8(SLIDE_LAYOUT) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: utf8(SLIDE_LAYOUT_RELS) },
    { name: 'ppt/theme/theme1.xml', data: utf8(THEME) },
  ];
  deck.slides.forEach((s, i) => {
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: utf8(slideXml(s.title, s.lines)) });
    // 每页 slide 引用同一个布局 slideLayout1（PowerPoint 严格校验目标必须存在）
    entries.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: utf8(SLIDE_RELS) });
  });
  const zip = await buildZip(entries);
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

// 便捷：把 deck 下载成 .pptx
export async function downloadPptx(deck, filename = '报告.pptx') {
  const blob = await buildPptxBlob(deck);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return blob;
}
