// Adapted from ShadcnStore's MIT-licensed Card slots; styles use the app's CSS tokens.
export function Card({ className = '', ...props }) { return <div data-slot="card" className={className} {...props}/>; }
export function CardHeader(props) { return <div data-slot="card-header" {...props}/>; }
export function CardTitle(props) { return <h2 data-slot="card-title" {...props}/>; }
export function CardDescription(props) { return <p data-slot="card-description" {...props}/>; }
export function CardAction(props) { return <div data-slot="card-action" {...props}/>; }
export function CardContent(props) { return <div data-slot="card-content" {...props}/>; }
export function CardFooter(props) { return <div data-slot="card-footer" {...props}/>; }
