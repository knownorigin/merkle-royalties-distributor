const {gql, request} = require('graphql-request');

const getTokenData = async (token_id) => {
  const koLookupQuery = gql`
      query getTokens($id: String!) {
          tokens(where:{id: $id}) {
              id
              version
              edition {
                  id
                  version
                  artistAccount
                  optionalCommissionAccount
                  optionalCommissionRate
                  collective {
                      recipients
                      splits
                  }
              }
          }
      }
  `;

  return await request(
    'https://api.thegraph.com/subgraphs/name/knownorigin/known-origin',
    koLookupQuery,
    {
      id: token_id
    }
  );
};

module.exports = {
  getTokenData
};
