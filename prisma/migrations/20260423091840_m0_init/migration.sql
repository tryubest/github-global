-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "email" CITEXT,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "githubInstallationId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "githubRepoId" INTEGER NOT NULL,
    "installationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "private" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoConfig" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "defaultTargetLangs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ignoreGlobs" JSONB NOT NULL DEFAULT '[]',
    "glossaryPath" TEXT NOT NULL DEFAULT '.github/i18n.yaml',
    "branchStrategy" TEXT NOT NULL DEFAULT 'append',
    "dailyCharLimit" INTEGER NOT NULL DEFAULT 500000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE INDEX "User_login_idx" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_githubInstallationId_key" ON "Installation"("githubInstallationId");

-- CreateIndex
CREATE INDEX "Installation_userId_idx" ON "Installation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubRepoId_key" ON "Repository"("githubRepoId");

-- CreateIndex
CREATE INDEX "Repository_installationId_idx" ON "Repository"("installationId");

-- CreateIndex
CREATE INDEX "Repository_fullName_idx" ON "Repository"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "RepoConfig_repositoryId_key" ON "RepoConfig"("repositoryId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoConfig" ADD CONSTRAINT "RepoConfig_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
