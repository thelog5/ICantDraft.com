import "dotenv/config";

async function main() {
  // Placeholder. ESPN/Yahoo jobs will be wired in next.
  // eslint-disable-next-line no-console
  console.log("worker ready");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

