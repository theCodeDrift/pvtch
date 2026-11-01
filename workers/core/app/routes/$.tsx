import { data } from 'react-router';

// Unknown paths render the page below with a real 404 status, for any method.
export function loader() {
  return data({}, { status: 404 });
}

export function action() {
  return data({}, { status: 404 });
}

export default function CatchAll() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">404</h1>
      <p className="text-muted-foreground mb-8">Page not found</p>
      <a
        href="/"
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90"
      >
        Go home
      </a>
    </div>
  );
}
