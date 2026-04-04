import type { NextPageContext } from "next";

type ErrorPageProps = {
  statusCode?: number;
};

function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f8fafc",
        color: "#0f172a",
        fontFamily:
          '"SF Pro Text","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Microsoft YaHei",sans-serif'
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, letterSpacing: "0.2em", textTransform: "uppercase", color: "#64748b" }}>
          Local Agent Lab
        </div>
        <h1 style={{ margin: "12px 0 8px", fontSize: 44 }}>
          {statusCode ? `Error ${statusCode}` : "Something went wrong"}
        </h1>
        <p style={{ margin: 0, fontSize: 16, color: "#475569" }}>
          The page could not be rendered.
        </p>
      </div>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;
