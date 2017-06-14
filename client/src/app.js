import React, { Component } from 'react';
import {
  AsyncStorage,
} from 'react-native';

import { ApolloClient } from 'apollo-client';
import { ApolloLink } from 'apollo-link';
import { ApolloProvider } from 'react-apollo';
import { composeWithDevTools, applyMiddleware } from 'redux-devtools-extension';
import { createHttpLink } from 'apollo-link-http';
import { createStore, combineReducers, applyMiddleware } from 'redux';
import { Provider } from 'react-redux';
import { ReduxCache, apolloReducer } from 'apollo-cache-redux';
import ReduxLink from 'apollo-link-redux';
import { WebSocketLink } from 'apollo-link-ws';
import { getMainDefinition } from 'apollo-utilities';
import { SubscriptionClient } from 'subscriptions-transport-ws';
import { persistStore, persistCombineReducers } from 'redux-persist';
import thunk from 'redux-thunk';
import _ from 'lodash';

import AppWithNavigationState, {
  navigationReducer, 
  navigationMiddleware,
} from './navigation';
import auth from './reducers/auth.reducer';
import { logout } from './actions/auth.actions';
import { FirebaseClient } from './firebase-client';

const URL = 'localhost:8080'; // set your comp's url here

const reducer = persistCombineReducers(config, {
  apollo: apolloReducer,
  nav: navigationReducer,
  auth,
});

const store = createStore(
  reducer,
  {}, // initial state
  composeWithDevTools(
    applyMiddleware(thunk, navigationMiddleware),
  ),
);

// persistent storage
const persistor = persistStore(store);

const cache = new ReduxCache({ store });

const reduxLink = new ReduxLink(store);

const httpLink = createHttpLink({ uri: `http://${URL}/graphql` });

// middleware for requests
networkInterface.use([{
  applyBatchMiddleware(req, next) {
    if (!req.options.headers) {
      req.options.headers = {};
    }
    // get the authentication token from local storage if it exists
    const jwt = store.getState().auth.jwt;
    if (jwt) {
      req.options.headers.authorization = `Bearer ${jwt}`;
    }
    next();
  },
}]);

// afterware for responses
networkInterface.useAfter([{
  applyBatchAfterware({ responses }, next) {
    let isUnauthorized = false;

    responses.forEach((response) => {
      if (response.errors) {
        console.log('GraphQL Error:', response.errors);
        if (_.some(response.errors, { message: 'Unauthorized' })) {
          isUnauthorized = true;
        }
      }
    });

    if (isUnauthorized) {
      store.dispatch(logout());
    }

    next();
  },
}]);

// Create WebSocket client
export const wsClient = new SubscriptionClient(`ws://${URL}/subscriptions`, {
  reconnect: true,
  connectionParams: {
    // Pass any arguments you want for initialization
  },
});

const webSocketLink = new WebSocketLink(wsClient);

const requestLink = ({ queryOrMutationLink, subscriptionLink }) =>
  ApolloLink.split(
    ({ query }) => {
      const { kind, operation } = getMainDefinition(query);
      return kind === 'OperationDefinition' && operation === 'subscription';
    },
    subscriptionLink,
    queryOrMutationLink,
  );

const link = ApolloLink.from([
  reduxLink,
  requestLink({
    queryOrMutationLink: httpLink,
    subscriptionLink: webSocketLink,
  }),
]);

export const client = new ApolloClient({
  link,
  cache,
  queryDeduplication: true,
});

export const firebaseClient = new FirebaseClient();

export default class App extends Component {
  render() {
    return (
      <ApolloProvider client={client}>
        <Provider store={store}>
          <PersistGate persistor={persistor}>
            <AppWithNavigationState />
          </PersistGate>
        </Provider>
      </ApolloProvider>
    );
  }
}
