// STL and 3MF writers. The 3MF follows Bambu Studio's project layout (also read
// by OrcaSlicer): one object with two parts, the body on filament 1 and the
// artwork on filament 2, so it opens with the colours already assigned.
// It must not claim Application=BambuStudio: Bambu then expects a full
// project (settings and all) and crashes on load without one.
import { zipSync, strToU8 } from 'fflate';

function meshArrays(manifold) {
  const m = manifold.getMesh();
  const n = m.numProp;
  const v = m.vertProperties, t = m.triVerts;
  const verts = new Float32Array((v.length / n) * 3);
  for (let i = 0, j = 0; i < v.length; i += n, j += 3) { verts[j] = v[i]; verts[j + 1] = v[i + 1]; verts[j + 2] = v[i + 2]; }
  return { verts, tris: t };
}

export function stl(manifold, name = 'merch-gyro') {
  const { verts, tris } = meshArrays(manifold);
  const nt = tris.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  const header = strToU8(name.slice(0, 79));
  new Uint8Array(buf, 0, header.length).set(header);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (let i = 0; i < nt; i++) {
    const a = tris[3 * i] * 3, b = tris[3 * i + 1] * 3, c = tris[3 * i + 2] * 3;
    const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
    const wx = verts[c] - verts[a], wy = verts[c + 1] - verts[a + 1], wz = verts[c + 2] - verts[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const f of [nx, ny, nz]) { dv.setFloat32(o, f, true); o += 4; }
    for (const p of [a, b, c]) for (let k = 0; k < 3; k++) { dv.setFloat32(o, verts[p + k], true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

function meshXml(id, manifold) {
  const { verts, tris } = meshArrays(manifold);
  const out = [`  <object id="${id}" type="model">\n   <mesh>\n    <vertices>\n`];
  for (let i = 0; i < verts.length; i += 3) out.push(`     <vertex x="${+verts[i].toFixed(5)}" y="${+verts[i + 1].toFixed(5)}" z="${+verts[i + 2].toFixed(5)}"/>\n`);
  out.push('    </vertices>\n    <triangles>\n');
  for (let i = 0; i < tris.length; i += 3) out.push(`     <triangle v1="${tris[i]}" v2="${tris[i + 1]}" v3="${tris[i + 2]}"/>\n`);
  out.push('    </triangles>\n   </mesh>\n  </object>\n');
  return out.join('');
}

const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';

/**
 * Two-colour project 3MF. `colours` are hex strings for filament 1 (body) and
 * 2 (artwork); slicers use them for the preview and the filament mapping.
 */
export function threeMf(body, art, { name = 'merch-gyro', colours = ['#1d1d1f', '#E7551E'] } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const objects = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
${meshXml(1, body)}${meshXml(2, art)} </resources>
 <build/>
</model>
`;
  const main = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${name}</metadata>
 <metadata name="Designer">merch-gyro</metadata>
 <metadata name="CreationDate">${today}</metadata>
 <resources>
  <object id="3" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
    <component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="3" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/>
 </build>
</model>
`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="3">
    <metadata key="name" value="${name}"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="body"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="1"/>
    </part>
    <part id="2" subtype="normal_part">
      <metadata key="name" value="logo"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="extruder" value="2"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="${name}"/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="3"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
  <assemble>
   <assemble_item object_id="3" instance_id="0" transform="1 0 0 0 1 0 0 0 1 128 128 0" offset="0 0 0" />
  </assemble>
</config>
`;
  const project = JSON.stringify({ filament_colour: colours, filament_type: ['PLA', 'PLA'] });
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="application/xml"/>
</Types>
`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`),
    '3D/_rels/3dmodel.model.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`),
    '3D/3dmodel.model': strToU8(main),
    '3D/Objects/object_1.model': strToU8(objects),
    'Metadata/model_settings.config': strToU8(settings),
    'Metadata/merch_gyro.json': strToU8(project),
  }, { level: 6 });
}
