-- CreateTable
CREATE TABLE "TranslationJob" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "commitSha" TEXT,
    "targetLangs" TEXT[],
    "modelId" TEXT NOT NULL,
    "branchName" TEXT,
    "prUrl" TEXT,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "doneFiles" INTEGER NOT NULL DEFAULT 0,
    "failedFiles" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TranslationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileTranslation" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL DEFAULT '',
    "translatedHash" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "skipReason" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationJob_status_queuedAt_idx" ON "TranslationJob"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "TranslationJob_repositoryId_queuedAt_idx" ON "TranslationJob"("repositoryId", "queuedAt");

-- CreateIndex
CREATE INDEX "FileTranslation_repositoryId_path_lang_createdAt_idx" ON "FileTranslation"("repositoryId", "path", "lang", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FileTranslation_repositoryId_path_lang_sourceHash_idx" ON "FileTranslation"("repositoryId", "path", "lang", "sourceHash");

-- CreateIndex
CREATE INDEX "FileTranslation_jobId_status_idx" ON "FileTranslation"("jobId", "status");

-- AddForeignKey
ALTER TABLE "TranslationJob" ADD CONSTRAINT "TranslationJob_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationJob" ADD CONSTRAINT "TranslationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileTranslation" ADD CONSTRAINT "FileTranslation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TranslationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileTranslation" ADD CONSTRAINT "FileTranslation_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
