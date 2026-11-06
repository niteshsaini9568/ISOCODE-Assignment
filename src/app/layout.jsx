import '../styles.css';
import '../template-theme.css';
import '../home-mosaic.css';
export const metadata={title:'Shortlist · IsoCode Labs',description:'Review CV evidence and share client shortlists.',icons:{icon:'/brand/shortlist-mark.svg'}};
export default function RootLayout({children}){return <html className="dark" lang="en" data-scroll-behavior="smooth"><body>{children}</body></html>;}
