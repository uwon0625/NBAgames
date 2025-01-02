"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceEnvPlaceholders = replaceEnvPlaceholders;
const cx_api_1 = require("@aws-cdk/cx-api");
const credential_provider_source_1 = require("../plugin/credential-provider-source");
/**
 * Replace the {ACCOUNT} and {REGION} placeholders in all strings found in a complex object.
 */
async function replaceEnvPlaceholders(object, env, sdkProvider) {
    return cx_api_1.EnvironmentPlaceholders.replaceAsync(object, {
        accountId: () => Promise.resolve(env.account),
        region: () => Promise.resolve(env.region),
        partition: async () => {
            // There's no good way to get the partition!
            // We should have had it already, except we don't.
            //
            // Best we can do is ask the "base credentials" for this environment for their partition. Cross-partition
            // AssumeRole'ing will never work anyway, so this answer won't be wrong (it will just be slow!)
            return (await sdkProvider.baseCredentialsPartition(env, credential_provider_source_1.Mode.ForReading)) ?? 'aws';
        },
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhY2Vob2xkZXJzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicGxhY2Vob2xkZXJzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBUUEsd0RBaUJDO0FBekJELDRDQUE0RTtBQUc1RSxxRkFBNEQ7QUFFNUQ7O0dBRUc7QUFDSSxLQUFLLFVBQVUsc0JBQXNCLENBQzFDLE1BQVMsRUFDVCxHQUFnQixFQUNoQixXQUF3QjtJQUV4QixPQUFPLGdDQUF1QixDQUFDLFlBQVksQ0FBQyxNQUFNLEVBQUU7UUFDbEQsU0FBUyxFQUFFLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQztRQUM3QyxNQUFNLEVBQUUsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDO1FBQ3pDLFNBQVMsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNwQiw0Q0FBNEM7WUFDNUMsa0RBQWtEO1lBQ2xELEVBQUU7WUFDRix5R0FBeUc7WUFDekcsK0ZBQStGO1lBQy9GLE9BQU8sQ0FBQyxNQUFNLFdBQVcsQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLEVBQUUsaUNBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxJQUFJLEtBQUssQ0FBQztRQUNyRixDQUFDO0tBQ0YsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHR5cGUgRW52aXJvbm1lbnQsIEVudmlyb25tZW50UGxhY2Vob2xkZXJzIH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB7IEJyYW5kZWQgfSBmcm9tICcuLi8uLi91dGlsL3R5cGUtYnJhbmRzJztcbmltcG9ydCB0eXBlIHsgU2RrUHJvdmlkZXIgfSBmcm9tICcuLi9hd3MtYXV0aC9zZGstcHJvdmlkZXInO1xuaW1wb3J0IHsgTW9kZSB9IGZyb20gJy4uL3BsdWdpbi9jcmVkZW50aWFsLXByb3ZpZGVyLXNvdXJjZSc7XG5cbi8qKlxuICogUmVwbGFjZSB0aGUge0FDQ09VTlR9IGFuZCB7UkVHSU9OfSBwbGFjZWhvbGRlcnMgaW4gYWxsIHN0cmluZ3MgZm91bmQgaW4gYSBjb21wbGV4IG9iamVjdC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcGxhY2VFbnZQbGFjZWhvbGRlcnM8QSBleHRlbmRzIFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4+KFxuICBvYmplY3Q6IEEsXG4gIGVudjogRW52aXJvbm1lbnQsXG4gIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbik6IFByb21pc2U8e1trIGluIGtleW9mIEFdOiBTdHJpbmdXaXRob3V0UGxhY2Vob2xkZXJzIHwgdW5kZWZpbmVkfT4ge1xuICByZXR1cm4gRW52aXJvbm1lbnRQbGFjZWhvbGRlcnMucmVwbGFjZUFzeW5jKG9iamVjdCwge1xuICAgIGFjY291bnRJZDogKCkgPT4gUHJvbWlzZS5yZXNvbHZlKGVudi5hY2NvdW50KSxcbiAgICByZWdpb246ICgpID0+IFByb21pc2UucmVzb2x2ZShlbnYucmVnaW9uKSxcbiAgICBwYXJ0aXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFRoZXJlJ3Mgbm8gZ29vZCB3YXkgdG8gZ2V0IHRoZSBwYXJ0aXRpb24hXG4gICAgICAvLyBXZSBzaG91bGQgaGF2ZSBoYWQgaXQgYWxyZWFkeSwgZXhjZXB0IHdlIGRvbid0LlxuICAgICAgLy9cbiAgICAgIC8vIEJlc3Qgd2UgY2FuIGRvIGlzIGFzayB0aGUgXCJiYXNlIGNyZWRlbnRpYWxzXCIgZm9yIHRoaXMgZW52aXJvbm1lbnQgZm9yIHRoZWlyIHBhcnRpdGlvbi4gQ3Jvc3MtcGFydGl0aW9uXG4gICAgICAvLyBBc3N1bWVSb2xlJ2luZyB3aWxsIG5ldmVyIHdvcmsgYW55d2F5LCBzbyB0aGlzIGFuc3dlciB3b24ndCBiZSB3cm9uZyAoaXQgd2lsbCBqdXN0IGJlIHNsb3chKVxuICAgICAgcmV0dXJuIChhd2FpdCBzZGtQcm92aWRlci5iYXNlQ3JlZGVudGlhbHNQYXJ0aXRpb24oZW52LCBNb2RlLkZvclJlYWRpbmcpKSA/PyAnYXdzJztcbiAgICB9LFxuICB9KTtcbn1cblxuZXhwb3J0IHR5cGUgU3RyaW5nV2l0aG91dFBsYWNlaG9sZGVycyA9IEJyYW5kZWQ8c3RyaW5nLCAnTm9QbGFjZWhvbGRlcnMnPjtcbiJdfQ==