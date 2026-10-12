import {createService} from './service.js';
import {documentationResponse} from './discovery.js';

const service = createService();
export default {
  fetch(request, env, ctx) {
    return documentationResponse(request) ?? service.fetch(request, env, ctx);
  },
};
