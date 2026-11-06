export async function collectPages(load,pageSize){
  const rows=new Map();
  for(let offset=0;;offset+=pageSize){const page=await load(offset);for(const row of page)rows.set(row.id??row.week,row);if(page.length<pageSize)return [...rows.values()];}
}
export async function collectRecordPages(load,field,pageSize){let first;const rows=await collectPages(async offset=>{const data=await load(offset);first??=data;return data[field];},pageSize);return {...first,[field]:rows};}
