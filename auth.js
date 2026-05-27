(function () {
  const PASSWORD = "GEEBINGO2026-JT";
  const SESSION_KEY = "jt-bingo-authenticated";

  if (sessionStorage.getItem(SESSION_KEY) === "true") {
    return;
  }

  const enteredPassword = window.prompt("Enter password to access JT-BINGO:");
  if (enteredPassword === PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, "true");
    return;
  }

  document.documentElement.innerHTML = `
    <head>
      <title>Access Denied</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          display: grid;
          min-height: 100vh;
          margin: 0;
          place-items: center;
          color: #09224a;
          font-family: Arial, Helvetica, sans-serif;
          background: #ffffff;
        }
        main {
          width: min(90vw, 28rem);
          padding: 2rem;
          text-align: center;
          border: 0.2rem solid #0b4da2;
          border-radius: 0.5rem;
        }
        h1 {
          margin: 0 0 0.75rem;
          color: #0b4da2;
        }
      </style>
    </head>
    <body>
      <main>
        <h1>Access Denied</h1>
        <p>Incorrect password.</p>
      </main>
    </body>
  `;
  throw new Error("Access denied");
})();
