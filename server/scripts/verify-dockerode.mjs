// Benign dependency/API acceptance only. Never uses an application database,
// network access, bind mounts or privileged containers.
import Docker from 'dockerode';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const image = process.env.TEST_SERVER_IMAGE;
if (!image || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]+$/.test(image)) throw new Error('TEST_SERVER_IMAGE must be an already built local fixture image');
const docker = new Docker();
await docker.getImage(image).inspect(); // Fail rather than pulling an arbitrary image.
const label = `threatcaddy-dockerode-${randomUUID()}`;
const originalCreate = Docker.prototype.createContainer;
const created = [];
Docker.prototype.createContainer = async function (options) {
  assert.equal(options.HostConfig.NetworkMode, 'none');
  assert.equal(options.HostConfig.ReadonlyRootfs, true);
  assert.equal(options.User, '65534:65534');
  assert.deepEqual(options.HostConfig.CapDrop, ['ALL']);
  assert.equal(options.HostConfig.Binds, undefined);
  const container = await originalCreate.call(this, { ...options, Labels: { ...options.Labels, 'com.threatcaddy.acceptance': label } });
  created.push(container);
  return container;
};
process.env.SANDBOX_NODE_IMAGE = image;
try {
  const { executeCode } = await import('../dist/bots/sandbox.js');
  const result = await executeCode('nodejs', 'console.log("ordinary fixture")', { timeout: 10 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), 'ordinary fixture');
  assert.equal(result.stderr, '');
  assert.equal(result.timedOut, false);
  const signal = AbortSignal.abort();
  await assert.rejects(executeCode('nodejs', 'console.log("ordinary fixture")', { signal }));
  assert.equal(created.length, 1);
  console.log('Dockerode create/attach/demux/start/wait and cancelled-run containment passed');
} finally {
  Docker.prototype.createContainer = originalCreate;
  for (const container of created) {
    try {
      const details = await container.inspect();
      assert.equal(details.Config.Labels['com.threatcaddy.acceptance'], label);
      await container.remove({ force: true });
    } catch (error) { if (error.statusCode !== 404) throw error; }
  }
}
