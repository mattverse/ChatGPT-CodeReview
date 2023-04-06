import { Octokit } from '@octokit/core';
import { Chat } from './chat.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAX_PATCH_COUNT = 4000;

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is missing.');
  return;
}

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is missing.');
  return;
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const { eventName, payload } = JSON.parse(process.env.GITHUB_EVENT_PATH || '{}');

if (!payload || !payload.pull_request) {
  console.error('No pull_request object found in the event payload.');
  return;
}

const loadChat = async (owner, repo, issueNumber, octokit) => {
  if (OPENAI_API_KEY) {
    return new Chat(OPENAI_API_KEY);
  }

  try {
    await octokit.issues.createComment({
      repo: repo,
      owner: owner,
      issue_number: issueNumber,
      body: `Seems you are using me but didn't get OPENAI_API_KEY set in Variables/Secrets for this repo. you could follow [readme](https://github.com/anc95/ChatGPT-CodeReview) for more information`,
    });
  } catch (error) {
    console.error('Error creating comment:', error);
  }

  return null;
};

export const robot = async () => {
  console.log("-----review started");

  const chat = await loadChat(payload.repository.owner.login, payload.repository.name, payload.pull_request.number, octokit);

  if (!chat) {
    return 'no chat';
  }

  const pull_request = payload.pull_request;

  if (pull_request.state === 'closed' || pull_request.locked || pull_request.draft) {
    return 'invalid event payload';
  }

  const data = await octokit.repos.compareCommits({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    base: payload.pull_request.base.sha,
    head: payload.pull_request.head.sha,
  });

  let { files: changedFiles, commits } = data.data;

  if (payload.action === 'synchronize' && commits.length >= 2) {
    const {
      data: { files },
    } = await octokit.repos.compareCommits({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      base: commits[commits.length - 2].sha,
      head: commits[commits.length - 1].sha,
    });

    const filesNames = files?.map((file) => file.filename) || [];
    changedFiles = changedFiles?.filter((file) => filesNames.includes(file.filename));
  }

  if (!changedFiles?.length) {
    return 'no change';
  }

  console.time('gpt cost');

  for (let i = 0; i < changedFiles.length; i++) {
    const file = changedFiles[i];
    const patch = file.patch || '';

    if(file.status !== 'modified' && file.status !== 'added') {
      continue;
    }

    if (!patch || patch.length > MAX_PATCH_COUNT) {
      continue;
    }

    const res = await chat.codeReview(patch);

    if (!!res) {
      await octokit.pulls.createReviewComment({
        repo: payload.repository.name,
        owner: payload.repository.owner.login,
        pull_number: payload.pull
        if (!!res) {
          await octokit.pulls.createReviewComment({
            repo: payload.repository.name,
            owner: payload.repository.owner.login,
            pull_number: payload.pull_request.number,
            commit_id: commits[commits.length - 1].sha,
            path: file.filename,
            body: res,
            position: patch.split('\n').length - 1,
          });
        }
      })
  
      console.timeEnd('gpt cost');
      console.info('success reviewed', payload.pull_request.html_url);
  
      return 'success';
    };
  }
} 

// main();
  