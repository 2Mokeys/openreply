import { encryptToken } from "@/lib/meta/oauth";
import { getUserInfo, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";

function readInstagramId(): string {
  const instagramId = process.argv[2]?.trim();
  if (!instagramId || !/^\d+$/.test(instagramId)) {
    throw new Error(
      "Usage: npx tsx --env-file=.env scripts/connect-system-user.ts <instagram-business-account-id>"
    );
  }
  return instagramId;
}

async function main() {
  process.env.DATABASE_URL ??= process.env.DATABASE_PUBLIC_URL;
  const { prisma } = await import("@/lib/db/client");
  try {
    const instagramId = readInstagramId();
    const token = process.env.META_TEST_TOKEN;
    if (!token) throw new Error("META_TEST_TOKEN is required");
    const workspaces = await prisma.workspace.findMany({ select: { id: true }, take: 2 });
    if (workspaces.length !== 1)
      throw new Error(`Expected one workspace, found ${workspaces.length}`);
    const workspaceId = workspaces[0].id;
    const existing = await prisma.instagramAccount.findUnique({ where: { instagramId } });
    if (
      existing &&
      (existing.workspaceId !== workspaceId || existing.provider !== "META")
    )
      throw new Error("Instagram account is already connected elsewhere");
    const profile = await getUserInfo(token, instagramId);
    let webhookSubscribed = existing?.webhookSubscribed ?? false;
    try {
      webhookSubscribed = (await subscribeInstagramAccountToWebhooks(instagramId, token)).success;
    } catch (error) {
      console.warn("Webhook subscription unchanged:", error instanceof Error ? error.message : error);
    }
    const data = {
      username: profile.username,
      name: profile.name,
      accessToken: encryptToken(token),
      tokenExpiresAt: null,
      webhookSubscribed,
    };
    const account = existing
      ? await prisma.instagramAccount.update({ where: { id: existing.id }, data })
      : await prisma.instagramAccount.create({
          data: { ...data, workspaceId, instagramId, provider: "META" },
        });
    console.log(`Connected @${account.username} (${account.instagramId}); webhook=${account.webhookSubscribed}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
