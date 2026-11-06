export default function Brand({compact=false,light=false}) {
  return <div className={`brand ${light?'light':''}`}>
    <img className="brand-monogram" src="/brand/shortlist-mark.svg" width="32" height="32" alt=""/>
    {!compact&&<div><strong>Shortlist<span className="brand-dot">.</span></strong><span>by IsoCode Labs</span></div>}
  </div>;
}
